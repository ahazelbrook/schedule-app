/* The action report card (suite B09, spine.stamp): the show kind `report`, a stamped position and effect and the one-line threatened consequence, held on the
   iPad until the GM marks the result (the page takes it off). Registers with B68Shows (app/display/shows.js) like the other brief beats; the look book draws
   its fixture. The server's bounds (functions/_lib/show.js): position controlled|risky|desperate, effect limited|standard|great, text at most 100.
   Looks come from app/tokens.css and app/display/shows.css. Rules text and numbers never appear here: the card names the stamp, not what it means.
   The fixture uses the invented cast only. */
(function (root) {
  'use strict';
  var S = root.B68Shows;
  if (!S) return;
  var C = S.C;
  var POSITIONS = ['controlled', 'risky', 'desperate'], EFFECTS = ['limited', 'standard', 'great'], RESULTS = ['clean', '45', '13'];
  function given(v) { return v !== undefined && v !== null && v !== ''; }

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }

  S.register('report', {
    label: 'Action report', ms: 180000, fixture: { position: 'risky', effect: 'standard', text: 'Wren Tully turns round' },
    /* KS15 (the roll as beats): the stakes, the result and the cost, as the look book's extra cards. The new stage (display/kit/roll.js) draws them as beats */
    fixtures: [
      { label: 'Action report', fixture: { position: 'risky', effect: 'standard', text: 'Wren Tully turns round' } },
      { label: 'Action report: the stakes', fixture: { position: 'risky', effect: 'standard', text: 'She calls the desk.', who: 'Ray' } },
      { label: 'Action report: the result', fixture: { position: 'risky', effect: 'standard', text: 'She calls the desk.', who: 'Ray', result: '45' } },
      { label: 'Action report: the cost', fixture: { position: 'risky', effect: 'standard', text: 'She calls the desk.', who: 'Ray', result: '45', cost: 'Lotte remembers your face.' } }
    ],
    clean: function (p) {
      var pos = C.oneOf(p.position, POSITIONS), eff = C.oneOf(p.effect, EFFECTS);
      if (!pos || !eff) return null;
      var t = C.text(p.text, 100);
      if (p.text !== undefined && p.text !== null && p.text !== '' && !t) return null;
      var out = { position: pos, effect: eff };
      if (t) out.text = t;
      /* KS15: who (40), result (clean | 45 | 13) and cost (60) are optional, with the server's bounds; one that is there but out of bounds is no beat */
      var w = C.text(p.who, 40), r = C.oneOf(p.result, RESULTS), c = C.text(p.cost, 60);
      if ((given(p.who) && !w) || (given(p.result) && !r) || (given(p.cost) && !c)) return null;
      if (w) out.who = w;
      if (r) out.result = r;
      if (c) out.cost = c;
      return out;
    },
    render: function (p, env) {
      var K = root.B68StageRoll; if (K && K.on()) { var kn = K.render(p, env); if (kn) return kn; }      /* KS15 (kit.stage): the roll as beats */
      var doc = env.document || root.document;
      var n = el(doc, 'div', 'dp-show dp-show-report dp-pos-' + p.position);
      n.setAttribute('data-show', 'report');
      if (env.reduced) n.setAttribute('data-reduced', '1');
      n.appendChild(el(doc, 'p', 'dp-show-kicker', 'Action report'));
      var row = el(doc, 'div', 'dp-report-row');
      var a = el(doc, 'p', 'dp-report-cell'), b = el(doc, 'p', 'dp-report-cell');
      a.appendChild(el(doc, 'span', 'dp-report-k', 'Position'));
      a.appendChild(el(doc, 'span', 'dp-report-v', p.position));
      b.appendChild(el(doc, 'span', 'dp-report-k', 'Effect'));
      b.appendChild(el(doc, 'span', 'dp-report-v', p.effect));
      row.appendChild(a); row.appendChild(b);
      n.appendChild(row);
      if (p.text) {
        n.appendChild(el(doc, 'p', 'dp-report-k dp-report-threat', 'If it goes wrong'));
        n.appendChild(el(doc, 'p', 'dp-show-line', p.text));
      }
      return n;
    }
  });
})(typeof self !== 'undefined' ? self : this);
