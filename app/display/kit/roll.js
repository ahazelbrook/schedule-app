/* display/kit/roll.js: the new stage: the roll as beats (B68StageRoll), the kit and stage build, KS15 (S4), behind the setting kit.stage.
   In the kit-stage and kit-lookbook bundles (app/routes.js): fetched only while the setting is on (or by the look book). It only defines
   B68StageRoll when it loads; it reads B68Kit, B68Stage and B68Ui only when it is called. ES5, window.B68StageRoll in the browser,
   module.exports under Node (checks/runtime/kit-stage-roll.test.mjs).

   The action report (show kind `report`, functions/_lib/show.js) carries position, effect, text? and, since KS15, who?, result?, cost?. The
   display's register for it (display/report-beat.js) hands its render to this file while on() (the setting on and this bundle in): one line.
     STAKES   no result: a lower plate, "Ray goes for it", "If it goes wrong: <the line>", and the position and effect as the side block.
     RESULT   result clean | 45 | 13: a rubber-stamp slam in plain words (You do it. / You do it. It costs. / It goes wrong.) and a timed plate
              (the line, on a 1-3). The desk lays it under the stamp's own id for 8 seconds; the plate shows m:ss and takes the beat down at 0.
     COST     result and cost: the stamp again (no second slam) and the cost on the plate, timed.
     LAST ROLL  each result or cost drawn also sets the idle stage's foot-left place (frame.slot('roll')): "Last roll · Ray · It costs". It sits
              under the overlay (stage.css hides the foot slots while an overlay is up), so it shows once the beat folds. MEMORY ONLY: it lives in
              this page (no stored key, no request); a reload, or the setting going off, clears it.
   Plain words only: no rules text and no numbers; the dice stay on the table. Every string goes in as text (B68Ui.node, B68Ui.fill,
   textContent). Nothing here makes a request. Reduced motion: no slam (the stamp is simply there).
   API
     on() -> bool                      the setting is on here and the kit is in
     render(p, env) -> Node | null     p: the cleaned payload; env: { document, reduced, stage (the frame), ms, age } from display-page.js
     chipText(last) -> text            last = { who, result, cost }        putChip(frame, doc) -> the chip in the frame's roll place | null
     last() -> { who, result, cost } | null       reset()   (tests and the look book)
     Pure = { beat(p), words(p) }       no DOM */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else if (root) root.B68StageRoll = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SLAM = { clean: 'You do it.', '45': 'You do it. It costs.', '13': 'It goes wrong.' };
  var SHORT = { clean: 'You do it', '45': 'It costs', '13': 'It went wrong' };
  var EDGE = { clean: 'out-six', '45': 'out-mid', '13': 'out-low' };
  var mem = null;

  function txt(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function result(p) { return p && Object.prototype.hasOwnProperty.call(SLAM, p.result) ? p.result : ''; }

  var Pure = {};
  Pure.beat = function (p) { var r = result(p); return !r ? 'stakes' : txt(p.cost, 60) && r !== 'clean' ? 'cost' : 'result'; };
  /* the words of a beat: what the plate says, the slam and the chip. No numbers, no rules text */
  Pure.words = function (p) {
    p = p || {};
    var who = txt(p.who, 40), line = txt(p.text, 100), r = result(p), beat = Pure.beat(p);
    var out = { beat: beat, kicker: who ? who + ' goes for it' : 'The roll', slam: r ? SLAM[r] : '', edge: r ? EDGE[r] : 'accent', title: '', line: '', side: '', eff: '' };
    if (beat === 'stakes') { out.title = line ? 'If it goes wrong: ' + line : ''; out.side = cap(p.position); out.eff = cap(p.effect); }
    else if (beat === 'cost') { out.kicker = 'It costs'; out.title = txt(p.cost, 60); out.line = who ? who + ' goes for it' : ''; }
    else if (r === '13') out.title = line;
    return out;
  };
  function chipText(l) { if (!l || !result(l)) return ''; var who = txt(l.who, 40); return 'Last roll · ' + (who ? who + ' · ' : '') + SHORT[l.result]; }

  function on() { return !!(W && W.B68Kit && typeof W.B68Kit.ready === 'function' && W.B68Kit.ready('stage') && W.B68Stage && W.B68Ui); }

  /* the last-roll place on the idle stage: one card, replaced each time; nothing when the frame is not there */
  function putChip(frame, doc) {
    var slot = frame && typeof frame.slot === 'function' ? frame.slot('roll') : null, U = W && W.B68Ui;
    if (!slot || !U || !mem) return null;
    var old = slot.querySelector('.ks15-chip');
    var c = U.node('card', { tag: 'div', heading: 0, body: chipText(mem), edge: EDGE[mem.result], cls: 'ks15-chip', attrs: { role: 'status' } }, doc);
    if (old && old.parentNode === slot) slot.replaceChild(c, old); else slot.appendChild(c);
    return c;
  }

  function render(p, env) {
    env = env || {};
    var St = W && W.B68Stage, U = W && W.B68Ui, doc = env.document || (W && W.document);
    if (!St || !U || !doc || !p) return null;
    var w = Pure.words(p);
    var n = doc.createElement('div');
    n.className = 'dp-show dp-show-report ks15-beat';
    n.setAttribute('data-show', 'report');
    n.setAttribute('data-ks15-beat', w.beat);
    if (env.reduced) n.setAttribute('data-reduced', '1');
    var left = Number(env.ms) - (Number(env.age) || 0), timed = w.beat !== 'stakes' && left > 0;
    if (w.slam) {
      var slam = doc.createElement('div'); slam.className = 'ks15-slam ui-edge-' + w.edge; slam.setAttribute('data-ks15-result', result(p));
      if (w.beat === 'cost') slam.setAttribute('data-ks15-still', '');           /* the cost follows the result: the stamp is already down */
      var word = doc.createElement('p'); word.className = 'ks15-slam-word'; word.textContent = w.slam; slam.appendChild(word);
      n.appendChild(slam);
    }
    var pl = St.plate({ kicker: w.kicker, title: w.title, line: w.line, side: w.side, edge: w.edge, timer: timed ? { ms: Number(env.ms) || left, endsAt: Date.now() + left } : 0 }, doc);
    if (pl) {
      pl.el.classList.add('ks15-plate');
      if (w.eff) { var e = doc.createElement('span'); e.className = 'ks15-eff'; e.textContent = w.eff; var sd = pl.slot('side'); if (sd) sd.appendChild(e); }
      var low = doc.createElement('div'); low.className = 'ks15-lower'; low.appendChild(pl.el); n.appendChild(low);
      /* the plate's timer ran out: the beat folds here on the iPad's clock (the server lets it go at the same moment; the next poll confirms) */
      if (timed) pl.onClear(function () { n.setAttribute('data-ks15-folded', ''); n.hidden = true; });
    }
    if (w.beat !== 'stakes') { mem = { who: txt(p.who, 40), result: result(p), cost: txt(p.cost, 60) }; putChip(env.stage, doc); }
    return n;
  }

  return { VERSION: 1, on: on, render: render, chipText: chipText, putChip: putChip, last: function () { return mem ? { who: mem.who, result: mem.result, cost: mem.cost } : null; },
    reset: function () { mem = null; }, Pure: Pure, SLAM: SLAM };
});
