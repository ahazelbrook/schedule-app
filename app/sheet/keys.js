/* sheet/keys.js — turning a key (suite ticket 1.8, switch spine.keyturn) and the key cabinet (5.6, switch between.keys).

   Window.B68SheetKeys, and module.exports under Node. In the core bundle (the sheet is on every route). The sheet (tracker.js) calls three hooks and does
   nothing else for keys: offer(ctx) / cards(ctx) draw into its Keys box, act(name, d, ctx) handles the buttons these draw, and autoCrit(res, play) is read
   by its action roll. With both switches off none of them is called and the Keys box is exactly what it was.

   Turning a key (the rule book's "turn a key"): once a key has three hits it can be turned. The player decides BEFORE the roll: the key deadlocks (the
   player picks reversed or intensified), Stress clears, and the next action roll is an automatic critical (no dice are read, the roll panel says so).
   The sheet records it on the character: play.keyTurn { seq, name, word, dir, at } so the GM page can lay the card over the iPad (app/gm/keyturn.js), and
   play.autoCrit { name, at } until that roll is made.

   The cabinet: each key a card that fills as it is hit (three pips); a flip button turns the card over to show both deadlocks (reversed, intensified).

   ctx (built by the sheet): { esc, input(path, value, placeholder, cls), pipRow(n, filled, act, extra), play, pb, ui, commit(), note(msg), confirm(msg) -> bool,
   now() -> ms, turn: bool (spine.keyturn is on) }
   PURE
     struck(k) -> bool          canTurn(k, pb) -> bool      turn(play, i, dir, nowMs, pb) -> { name, word, dir, seq } | null      autoCrit(res, play) -> bool */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68SheetKeys = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NEED = 3;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function struck(k) { return !!(isObj(k) && (k.deadlock || k.glitch)); }
  function hitsOf(k) { var n = Math.floor(+(isObj(k) && k.hits) || 0); return n < 0 ? 0 : n > NEED ? NEED : n; }
  /* a key can be turned at three hits while it is not struck out. A playbook whose keys are struck with an irregularity or a glitch (the Echo, the Time
     Traveler) does not deadlock, and the Echo's own rule says it cannot turn keys */
  function canTurn(k, pb) {
    if (!isObj(k) || struck(k) || hitsOf(k) < NEED) return false;
    if (isObj(pb) && (pb.ghost || pb.timetraveler || pb.vampire)) return false;
    return true;
  }
  function wordOf(k, dir) { return dir === 'up' ? str(k.up) : str(k.down); }

  /* turn key i in direction 'up' (intensified) or 'down' (reversed): deadlock it, clear Stress, owe the next action roll a critical. Returns what happened or null */
  function turn(play, i, dir, nowMs, pb) {
    if (!isObj(play) || !Array.isArray(play.keys) || (dir !== 'up' && dir !== 'down')) return null;
    var k = play.keys[i];
    if (!canTurn(k, pb)) return null;
    var prev = isObj(play.keyTurn) ? Math.floor(+play.keyTurn.seq) || 0 : 0, at = new Date(typeof nowMs === 'number' ? nowMs : Date.now()).toISOString();
    var name = str(k.name).trim() || 'A key', word = wordOf(k, dir).trim() || (dir === 'up' ? 'Intensified' : 'Reversed');
    k.deadlock = dir;
    play.stress = 0;
    play.autoCrit = { name: name, at: at };
    play.keyTurn = { seq: prev + 1, name: name, word: word, dir: dir, at: at };
    return { name: name, word: word, dir: dir, seq: prev + 1 };
  }

  /* the action roll reads this right after rolling: a turned key makes it a critical (two sixes), once */
  function autoCrit(res, play) {
    if (!isObj(res) || !isObj(play) || !isObj(play.autoCrit)) return false;
    var name = str(play.autoCrit.name);
    res.dice = [6, 6]; res.value = 6; res.crit = true; res.low = false; res.reading = 'critical'; res.auto = true; res.n = 2;
    res.autoText = 'automatic critical' + (name ? ' (' + name + ' turned)' : '');
    delete play.autoCrit;
    return true;
  }

  /* ---------- drawing ---------- */
  function banner(ctx) {
    var a = isObj(ctx.play) && ctx.play.autoCrit;
    if (!isObj(a)) return '';
    return '<p class="hint ds-kt-auto">Automatic critical waiting' + (a.name ? ' (' + ctx.esc(a.name) + ' turned)' : '') + ': your next action roll is a critical, no dice.</p>';
  }
  function turnButtons(ctx, k, i) {
    if (!ctx.turn || !canTurn(k, ctx.pb)) return '';
    var e = ctx.esc;
    return '<div class="ds-kt-offer"><span class="ds-kt-say">You can turn this key</span><span class="ds-kt-btns">' +
      '<button type="button" class="btn sm" data-act="kturn" data-i="' + i + '" data-dir="down" title="Deadlock it as reversed, clear Stress, next action is an automatic critical">▼ ' + e(k.down || 'reversed') + '</button>' +
      '<button type="button" class="btn sm" data-act="kturn" data-i="' + i + '" data-dir="up" title="Deadlock it as intensified, clear Stress, next action is an automatic critical">▲ ' + e(k.up || 'intensified') + '</button></span></div>';
  }
  /* spine.keyturn alone: a quiet line under the keys that have three hits (nothing for any other key) */
  function offer(ctx) {
    var play = ctx.play, h = '';
    (Array.isArray(play.keys) ? play.keys : []).forEach(function (k, i) {
      var b = turnButtons(ctx, k, i);
      if (b) h += '<div class="ds-kt-row"><b>' + ctx.esc(str(k.name) || 'Key') + '</b>' + b + '</div>';
    });
    return banner(ctx) + h;
  }
  /* between.keys: a card per key */
  function cards(ctx) {
    var e = ctx.esc, play = ctx.play, ui = ctx.ui, h = banner(ctx), flip = isObj(ui.keyFlip) ? ui.keyFlip : {};
    h += '<div class="ds-kc">';
    (Array.isArray(play.keys) ? play.keys : []).forEach(function (k, i) {
      var st = struck(k), n = hitsOf(k), back = flip[i] === true, glitch = !!k.glitch;
      h += '<div class="ds-kcard' + (st ? ' locked' : '') + (n >= NEED && !st ? ' full' : '') + (back ? ' back' : '') + '" data-key="' + i + '">';
      if (!back) {
        h += '<div class="ds-kc-top">' + ctx.input('keys.' + i + '.name', k.name, 'Key', 'ds-key-name') + '<button type="button" class="ds-x" data-act="kflip" data-i="' + i + '" aria-label="Turn the card over" title="Both deadlocks">⟲</button></div>' +
          '<div class="ds-kc-fill" role="img" aria-label="' + n + ' of ' + NEED + ' hits"><span class="ds-kc-bar"><i style="width:' + Math.round(n / NEED * 100) + '%"></i></span>' + ctx.pipRow(NEED, n, 'keyhit', ' data-i="' + i + '"') + '</div>';
        if (glitch) h += '<p class="ds-kc-state">Glitch: ' + e(k.glitch) + ' (permanent)</p>';
        else if (st) h += '<p class="ds-kc-state">Deadlocked: ' + (k.deadlock === 'up' ? '▲ ' + e(k.up || 'intensified') : '▼ ' + e(k.down || 'reversed')) + ' <span class="ds-perm">permanent</span></p>';
        else h += turnButtons(ctx, k, i) || '<p class="ds-kc-state ds-dim">' + (n >= NEED ? 'Three hits.' : (NEED - n) + ' more hit' + (NEED - n === 1 ? '' : 's') + ' to turn it') + '</p>';
      } else {
        h += '<div class="ds-kc-top"><b class="ds-key-name">' + e(str(k.name) || 'Key') + '</b><button type="button" class="ds-x" data-act="kflip" data-i="' + i + '" aria-label="Turn the card back" title="Back to the key">⟲</button></div>' +
          '<div class="ds-kc-dl"><span class="ds-lab">▼ Reversed</span>' + ctx.input('keys.' + i + '.down', k.down, 'reversed', 'ds-key-word') + '</div>' +
          '<div class="ds-kc-dl"><span class="ds-lab">▲ Intensified</span>' + ctx.input('keys.' + i + '.up', k.up, 'intensified', 'ds-key-word') + '</div>';
      }
      h += '<button type="button" class="ds-x ds-kc-rm" data-act="rmkey" data-i="' + i + '" title="Remove key" aria-label="Remove key">×</button></div>';
    });
    return h + '</div>';
  }

  /* the buttons these draw; true when handled */
  function act(name, d, ctx) {
    if (name === 'kflip') {
      var f = isObj(ctx.ui.keyFlip) ? ctx.ui.keyFlip : (ctx.ui.keyFlip = {}), i = +d.i;
      if (f[i]) delete f[i]; else f[i] = true;
      ctx.commit(); return true;
    }
    if (name === 'kturn') {
      if (!ctx.turn) return true;
      var k = ctx.play.keys && ctx.play.keys[+d.i];
      if (!k || !canTurn(k, ctx.pb)) return true;
      var dir = d.dir === 'up' ? 'up' : 'down', w = wordOf(k, dir) || (dir === 'up' ? 'intensified' : 'reversed');
      if (!ctx.confirm('Turn ' + (str(k.name) || 'this key') + ' (' + (dir === 'up' ? '▲ ' : '▼ ') + w + ')? Decide BEFORE you roll. The key deadlocks for good, your Stress clears, and your next action roll is an automatic critical.')) return true;
      var r = turn(ctx.play, +d.i, dir, typeof ctx.now === 'function' ? ctx.now() : Date.now(), ctx.pb);
      if (r) ctx.note('Key turned: Stress cleared, next action is an automatic critical');
      ctx.commit(); return true;
    }
    return false;
  }

  return { NEED: NEED, struck: struck, hitsOf: hitsOf, canTurn: canTurn, turn: turn, autoCrit: autoCrit, offer: offer, cards: cards, act: act, banner: banner };
});
