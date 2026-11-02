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
  var POSITIONS = ['controlled', 'risky', 'desperate'], EFFECTS = ['limited', 'standard', 'great'];

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }

  S.register('report', {
    label: 'Action report', ms: 180000, fixture: { position: 'risky', effect: 'standard', text: 'Wren Tully turns round' },
    clean: function (p) {
      var pos = C.oneOf(p.position, POSITIONS), eff = C.oneOf(p.effect, EFFECTS);
      if (!pos || !eff) return null;
      var t = C.text(p.text, 100);
      if (p.text !== undefined && p.text !== null && p.text !== '' && !t) return null;
      var out = { position: pos, effect: eff };
      if (t) out.text = t;
      return out;
    },
    render: function (p, env) {
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
