/* The opportunity board on the table display (suite ticket 5.1, switch between.board): the show kind `board` for the B05 registry (app/display/shows.js).
   Cards the players posted from their sheets (a client, a target or an operation), pinned to a cork board with a pin each, for the Planning phase.
   A card the table picked is stamped PICKED; one nobody picked on an earlier night carries a CARRIED OVER tag with the number of nights (no book wording is here).
   The server's bounds (functions/_lib/show-board.js): up to 12 cards, text at most 120, who at most 40, kind client|target|operation, carried a digit string,
   pick the index of one card. The payload is parallel lists of plain strings (cards, who, kinds, carried) and an optional number.
   Looks come from app/tokens.css and app/display/board.css. Every string reaches the page by textContent. The look book draws the fixtures (invented cast only). */
(function (root) {
  'use strict';
  var S = root.B68Shows;
  if (!S) return;
  var C = S.C;
  var KINDS = ['client', 'target', 'operation'], LABEL = { client: 'Client', target: 'Target', operation: 'Operation' };

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }
  function list(v, one) {
    if (!Array.isArray(v) || v.length < 1 || v.length > 12) return null;
    var out = v.map(one);
    return out.some(function (x) { return x === undefined; }) ? null : out;
  }

  function clean(p) {
    var cards = list(p.cards, function (x) { return C.text(x, 120); });
    if (!cards) return null;
    var who = list(p.who, function (x) { return C.text(x, 40); });
    var kinds = list(p.kinds, function (x) { return C.oneOf(x, KINDS); });
    var carried = list(p.carried, function (x) { return typeof x === 'string' && /^[0-9]$/.test(x) ? x : undefined; });
    if (!who || !kinds || !carried || who.length !== cards.length || kinds.length !== cards.length || carried.length !== cards.length) return null;
    var out = { cards: cards, who: who, kinds: kinds, carried: carried };
    if (p.pick !== undefined && p.pick !== null) { var k = C.whole(p.pick, 0, cards.length - 1); if (k === undefined) return null; out.pick = k; }
    return out;
  }

  var FOUR = {
    cards: ['A fixer at the Pelican Rooms wants a ledger fetched', 'The cashier who keeps the Rooms’ second set of books', 'Lift the night takings on the quiet side of the hall', 'A widow with a grudge against the Rooms’ owner'],
    who: ['Wren', 'Nell', 'Wren', 'Pip'], kinds: ['client', 'target', 'operation', 'client'], carried: ['0', '0', '0', '2']
  };
  var PICKED = {
    cards: ['A fixer at the Pelican Rooms wants a ledger fetched', 'The cashier who keeps the Rooms’ second set of books', 'Lift the night takings on the quiet side of the hall'],
    who: ['Wren', 'Nell', 'Wren'], kinds: ['client', 'target', 'operation'], carried: ['0', '0', '1'], pick: 2
  };

  S.register('board', {
    label: 'Opportunity board', ms: 180000,
    fixture: FOUR,
    fixtures: [{ label: 'Opportunity board: four posted', fixture: FOUR }, { label: 'Opportunity board: one picked', fixture: PICKED }],
    clean: clean,
    render: function (p, env) {
      var doc = env.document || root.document;
      var n = el(doc, 'div', 'dp-show dp-show-board dp-count-' + Math.min(p.cards.length, 12));
      n.setAttribute('data-show', 'board');
      if (env.reduced) n.setAttribute('data-reduced', '1');
      n.appendChild(el(doc, 'p', 'dp-show-kicker', 'Planning'));
      n.appendChild(el(doc, 'p', 'dp-show-head', 'The opportunity board'));
      var cork = el(doc, 'div', 'dp-bd-cork');
      p.cards.forEach(function (text, i) {
        var c = el(doc, 'div', 'dp-bd-card dp-bd-' + p.kinds[i] + (p.pick === i ? ' dp-bd-picked' : '') + (p.carried[i] !== '0' ? ' dp-bd-late' : ''));
        c.style.setProperty('--i', String(i));
        c.setAttribute('data-kind', p.kinds[i]);
        c.appendChild(el(doc, 'i', 'dp-bd-pin'));
        c.appendChild(el(doc, 'p', 'dp-bd-kind', LABEL[p.kinds[i]]));
        c.appendChild(el(doc, 'p', 'dp-bd-text', text));
        c.appendChild(el(doc, 'p', 'dp-bd-who', p.who[i]));
        if (p.carried[i] !== '0') c.appendChild(el(doc, 'p', 'dp-bd-tag', 'Carried over ×' + p.carried[i]));
        if (p.pick === i) c.appendChild(el(doc, 'p', 'dp-bd-stamp', 'Picked'));
        cork.appendChild(c);
      });
      n.appendChild(cork);
      return n;
    }
  });
})(typeof self !== 'undefined' ? self : this);
