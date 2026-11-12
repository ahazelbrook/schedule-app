/* gm/kit/roll.js: the Roll on the new desk (kit.desk, KS06 of the kit and stage build). In the kit-desk bundle: fetched only while the setting is on.
   It defines B68KitRoll when it loads and reads other modules (B68Ui, B68GmRoll, B68Kit, B68GmPage) only when it is called (the kit's load-order rule).

   Alex, 07/11: "Dice can be formatted better. More dot points and text colour to help me skim it." Presentation only: the Fixer's words, its order, its
   prompt and its timing are the page's and the Worker's, untouched (gm/stamp.js and gm/roll.js are not edited; one stamp still asks one fit).

   HOW IT IS IN. The page keeps its own shell (gm/roll.js shell()). While the desk is on and its bundle is here (B68Kit.ready('desk'), B68Ui), mount(section)
   swaps the shell's top card, #gm-rl, for this file's card: the same ids, every data-gm and the hook classes (gm-btn, gm-whob, gm-stampb, gm-fitb, gm-rl-up,
   gm-fx-*), so the page's handlers, painters and checks find them. The old card is kept, detached, on the section and put back when the desk goes off
   (its listeners and its caches intact). #gm-rackf, #gm-fxhit and #gm-mini stay the page's own elements and carry a kr- class while this card is in.
   The page asks for the renderers through rollR(): this object while drawn(#gm-rl), else B68GmRoll. Everything not drawn here is B68GmRoll's.
     The card     The roll · Who (chips) · Position and Effect (two full-width segmented controls; the size under Position) · If it goes wrong
                  (a field, its x) · STAMP (the Roll's one Primary) with a quiet Fit beside it. Stamped: On the iPad (a chip, with what went up),
                  Stamp again (only once what is set has changed, as before: a second stamp is a second fit), Take it down (Esc), Clean (no card).
                  KS15 (kit.stage, the roll as beats) is mirrored here, from the same stamp view as the old card: the result's words beside On the
                  iPad (and on the pin), "Stamp it on the iPad" while a result is up, Clean saying "Clean: You do it." over the stakes, and after a
                  4/5 or a 1-3 the "Cost on the iPad" field (a B68Ui Field, #gm-stamp-cost; Enter sends) under the actions. The words come from
                  B68GmRoll (RESULT_WORDS, cleanWords, costNote); the field's DOM side is B68GmRoll's costBind / costKeep, passed through.
     They rolled  the four keys as full-width rows: the outcome colour as the left edge and the word (Before the bargain's colour, 4/5, 1-3; Someone
                  is no outcome: the ink edge), the key at the right. Keys 1 to 4 are the page's, unchanged.
     The Fixer    the dice (the time, the position and the effect) in one small mono line, the line it was fitted for under it; then each outcome as
                  one row with its colour edge: the word, the lead in bold, the rest as bullets (one a sentence, the words as sent), and the cost (the
                  size) as a chip in the outcome's colour. The row marked on the Roll says Rolled. The hit line over the result card is a Card with
                  the outcome's edge. While a stamp is up, its one line (On the iPad, who, position and effect, Take it down) is pinned above the
                  Blade fold (#kr-pin, sticky). When a fit's lines land, the column moves once (a cut) to show the pin and the whole answer: not while a
                  field in the column has the focus (it waits for the focus to leave), and not at all once the column was scrolled since the fit was asked.
     The Rack    Voice as a Card: the NPC, the lines as bullets, Clear and Another. Focus (F): the position, then the four keys with their edges.
   API (window.B68KitRoll; module.exports under Node)
     on() -> bool              the desk is on, its bundle here, and B68Ui and B68GmRoll loaded
     drawn(el) -> bool         el (the page's #gm-rl) is this file's card
     mount(section) -> bool    swap #gm-rl in or out to follow on(); true when it swapped (the page then paints everything)
     start()                   listen to the desk (B68Kit.onChange) and ask the page to follow (B68GmPage.rollKit)
     the renderers (B68GmRoll's names): posHtml effHtml whoHtml stampHtml costHtml buttonsHtml miniHtml lineNote cleanWords card(); and the page's
       own, drawn here: rackHtml(r, ctx), hitHtml(row, o), voiceHtml(vo, can). Every other B68GmRoll function is passed through (costBind and
       costKeep among them: gm-page.js b09Paint asks rollR() for them, so with the desk on they must answer here too).
     pure: EDGE, FX_EDGE, points(text) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root && root.document && !root.B68KitRoll) { root.B68KitRoll = M; M.start(); }
})(typeof window !== 'undefined' ? window : null, function (W) {
  'use strict';

  var EDGE = { before: 'out-deal', fourfive: 'out-mid', onetothree: 'out-low', someone: 'ink' };       /* They rolled: Someone is no outcome */
  var FX_EDGE = { deal: 'out-deal', mid: 'out-mid', low: 'out-low', six: 'out-six', crit: 'out-crit' };  /* the page's FX_ROWS third column */
  var POS_CLS = { controlled: 'is-ctl', risky: 'is-risky', desperate: 'is-desp' };
  var EFFECTS = ['limited', 'standard', 'great'];
  var KEPT = '__krOld', listening = false, M = {};

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cap(s) { s = str(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function ui() { return (W && W.B68Ui) || M._ui || null; }
  function old() { return (W && W.B68GmRoll) || M._old || null; }

  /* the Fixer's say as points: split after a sentence's end (. ! ? or an ellipsis, closing quotes kept) where the next starts with a capital, a digit or a
     quote, never after a title or a short form (Mr. Dr. St. e.g.). The words and their order are the Fixer's; only the breaks are new */
  var SHORT = /(?:^|\s)(?:mr|mrs|ms|dr|st|mt|jr|sr|no|vs|etc|e\.g|i\.e|[a-z])$/i;
  function points(text) {
    var s = str(text).replace(/\s+/g, ' ').trim();
    if (!s) return [];
    return s.replace(/([.!?…]["'”’)\]]*)\s+(?=[A-Z0-9"'“‘(])/g, function (m, end, at, all) {
      return end.charAt(0) === '.' && SHORT.test(all.slice(0, at)) ? m : end + '\u0000';
    }).split('\u0000').map(function (p) { return p.trim(); }).filter(Boolean);
  }

  /* ---------- the card (#gm-rl) ---------- */
  function card() {
    var U = ui();
    return '<div class="gm-rl kr-roll" id="gm-rl" data-kr="1" role="group" aria-labelledby="gm-rl-h">' +
      '<p class="gm-rl-h kr-title" id="gm-rl-h">The roll</p>' +
      '<div class="gm-rl-who kr-who" id="gm-who-row" hidden><span class="kr-lab" id="gm-who-l" title="Who is rolling: Blade and L get the name. Optional; cleared once the roll resolves">Who</span>' +
        '<span class="gm-who kr-chips" id="gm-who" role="radiogroup" aria-labelledby="gm-who-l"></span></div>' +
      '<div class="gm-pos kr-segbox" id="gm-pos"></div>' +
      '<p class="gm-rl-size kr-size" id="gm-pos-size"></p>' +
      '<div class="gm-eff kr-segbox" id="gm-eff"></div>' +
      '<div class="gm-rl-line kr-line">' +
        U.field({ label: 'If it goes wrong', kind: 'textarea', id: 'gm-c-threat', cls: 'kr-in', data: { ctl: 'threat' }, placeholder: 'One line the players see before the dice',
          attrs: { rows: '2', maxlength: '100', autocomplete: 'off', spellcheck: 'false' } }) +
        U.button({ label: '×', rank: 'quiet', cls: ['gm-rl-x', 'kr-x'], data: { gm: 'line-clear' }, title: 'Clear the line', attrs: { 'aria-label': 'Clear the line' } }) +
        '<p class="gm-rl-note kr-note" id="gm-line-note" hidden></p></div>' +
      '<div class="kr-stamprow"><div class="gm-stamp kr-stamp" id="gm-stamp"></div>' +
        U.button({ label: 'Fit', rank: 'quiet', id: 'gm-fitnow', cls: ['gm-fitb', 'kr-fit'], data: { gm: 'fitnow' }, hidden: true,
          title: 'Ask Blade to fit this roll without stamping it (a stamp asks by itself)' }) + '</div>' +
      '<p class="kr-lab kr-they" id="gm-they-l">They rolled</p>' +
      '<div class="gm-buttons kr-sits" id="gm-buttons" role="group" aria-labelledby="gm-they-l"></div>' +
      '</div>';
  }

  /* ---------- the renderers the page asks for (gm/roll.js names) ---------- */
  function seg(label, items, cur, kind, cls, sizeOf) {
    return '<p class="kr-lab" aria-hidden="true">' + esc(label) + '</p>' + ui().seg({ label: label, cls: 'kr-seg', attrs: { role: 'radiogroup' }, value: cur,
      items: items.map(function (it) {
        var v = str(it.value), sz = sizeOf ? sizeOf(it) : '';
        return { label: cap(it.label || v), value: v, cls: [cls].concat(POS_CLS[v] && kind === 'pos' ? [POS_CLS[v]] : []), data: { gm: kind, v: v },
          attrs: { role: 'radio', 'aria-checked': String(v === cur) }, title: sz ? cap(it.label || v) + ': ' + sz : '' };
      }) });
  }
  function posHtml(positions, cur) {
    var l = (Array.isArray(positions) ? positions : []).filter(function (p) { return p && str(p.value); }), R = old();
    return l.length ? seg('Position', l, str(cur), 'pos', 'gm-posb', function (p) { return R ? R.sizeText(p) : ''; }) : '';
  }
  function effHtml(cur) { return seg('Effect', EFFECTS.map(function (e) { return { value: e }; }), str(cur), 'eff', 'gm-effb'); }
  function whoHtml(pcs, cur) {
    var U = ui(), c = str(cur);
    return (Array.isArray(pcs) ? pcs : []).filter(function (p) { return p && str(p.value); }).map(function (p) {
      var v = str(p.value);
      return U.chip({ label: p.label || v, button: true, pressed: v === c, cls: ['gm-whob', 'kr-whob'], data: { gm: 'who', v: v }, title: v,
        attrs: { role: 'radio', 'aria-checked': String(v === c) } });
    }).join('');
  }
  /* the stamp's one-line status pinned above the Blade fold (#kr-pin, sticky in the column), so what is up stays in sight once the column has moved
     down to the Fixer's answer: On the iPad, who, the position and effect, and Take it down (the page's own data-gm="stamp-down") */
  function pinPaint(v) {
    var doc = W && W.document, el = doc && doc.getElementById('kr-pin'); if (!el) return;
    var a = v && v.on ? v.active : null, h = '';
    if (a) {
      var w = doc.querySelector('#gm-who [data-gm="who"][aria-checked="true"]'), who = w ? str(w.textContent).trim() : '';
      h = '<div class="kr-pinrow">' + ui().chip({ label: 'On the iPad', tone: 'accent', dot: true, cls: 'kr-upchip' }) +
        '<span class="kr-pinwhat">' + esc((who ? who + ', ' : '') + a.position + ', ' + a.effect + (a.result ? '. ' + resultWords(a) : '')) + '</span>' +
        ui().button({ label: 'Take it down', key: 'Esc', cls: 'kr-pindown', data: { gm: 'stamp-down' }, title: 'Takes the action report off the iPad' }) + '</div>';
    }
    if (el.__html !== h) { el.innerHTML = h; el.__html = h; }
    el.hidden = !h;
  }
  /* KS15 (kit.stage) mirrored: the result's words beside On the iPad, "Stamp it on the iPad" (not "again") while a result is up, Clean saying what it
     does, and the "Cost on the iPad" field. The words are B68GmRoll's (RESULT_WORDS, cleanWords, costNote), so both Rolls say the same; the field keeps
     the old card's hooks (#gm-stamp-cost, data-gm="stamp-cost") so the page's costBind / costKeep (passed through below) and its checks find it.
     Only a stamp view made with kit.stage on carries `result`, `cost` and `beats`: with it off this is KS06's card, unchanged */
  function resultWords(a) { var R = old(), w = R && R.RESULT_WORDS; return a && a.result && w ? str(w[a.result]) + (a.cost ? ' ' + str(a.cost) : '') : ''; }
  function cleanWords(v, a) { var R = old(); return R && typeof R.cleanWords === 'function' ? R.cleanWords(v, a) : ['Clean (no card)', 'Take the card down; the roll needs no consequence']; }
  function costHtml(c) {
    if (!c || typeof c !== 'object') return '';
    var R = old();
    return '<div class="gm-rl-cost kr-costline">' + ui().field({ label: 'Cost on the iPad', kind: 'textarea', id: 'gm-stamp-cost', cls: ['kr-in', 'kr-costin'], data: { gm: 'stamp-cost' },
      value: str(c.draft), placeholder: 'What it cost, in plain words', hint: R && typeof R.costNote === 'function' ? R.costNote(c) : '',
      attrs: { rows: '1', maxlength: '60', autocomplete: 'off', spellcheck: 'false' } }) + '</div>';
  }
  function stampHtml(v) {
    v = v || {};
    pinPaint(v);
    if (!v.on) return '';
    var U = ui(), a = v.active;
    if (!a) return U.button({ label: 'Stamp it on the iPad', rank: 'primary', cls: ['gm-stampb', 'kr-stampb'], data: { gm: 'stamp' },
      title: 'The position, the effect and the line, as an action report on the iPad before the dice. Enter in the line does it too' }) + costHtml(v.cost);
    var res = resultWords(a), cw = cleanWords(v, a);
    return '<p class="gm-rl-up kr-up" role="status">' + U.chip({ label: 'On the iPad', tone: 'accent', dot: true, cls: 'kr-upchip' }) +
        '<span class="kr-upwhat">' + esc(cap(a.position) + ', ' + a.effect) + '</span>' +
        (res ? '<span class="kr-upres">' + esc(res) + '</span>' : '') +
        (v.stale && !a.result ? '<span class="gm-rl-chg kr-chg">Changed since it went up</span>' : '') + '</p>' +
      (v.stale || a.result ? U.button({ label: a.result ? 'Stamp it on the iPad' : 'Stamp again', rank: 'primary', cls: ['gm-stampb', 'kr-stampb'], data: { gm: 'stamp' },
        title: a.result ? 'The next roll: it takes the place of what is up' : 'Puts what is set now on the iPad in its place' }) : '') +
      '<div class="gm-rl-acts kr-acts">' +
        U.button({ label: 'Take it down', key: 'Esc', cls: 'kr-down', data: { gm: 'stamp-down' }, title: 'Takes the action report off the iPad' }) +
        U.button({ label: cw[0], rank: 'quiet', cls: 'kr-clean', data: { gm: 'stamp-clean' }, title: cw[1] }) + '</div>' + costHtml(v.cost);
  }
  function buttonsHtml(sits) {
    var U = ui();
    return (Array.isArray(sits) ? sits : []).map(function (b) {
      return U.button({ label: b.label, key: str(b.key), cls: ['gm-btn', 'gm-sbtn', 'kr-sit', 'ui-edge-' + (EDGE[b.id] || 'ink')], data: { gm: 'situation', n: str(b.key), sit: str(b.id) },
        title: b.hint || b.label });
    }).join('');
  }
  function miniHtml(sits, pos, eff, up) {
    var U = ui(), p = str(pos);
    var head = p ? '<p class="gm-mini-pos kr-mini-pos ' + (POS_CLS[p] || '') + (up ? ' up' : '') + '" title="' + esc('Position: ' + p + (eff ? ', ' + eff : '') + (up ? '. Stamped on the iPad' : '') + '. F shows the whole roll') + '">' +
      '<b>' + esc(cap(p)) + '</b>' + (eff ? '<small>' + esc(eff) + '</small>' : '') + (up ? '<small class="gm-mini-up">● iPad</small>' : '') + '</p>' : '';
    return head + (Array.isArray(sits) ? sits : []).map(function (b) {
      return U.button({ label: str(b.label).slice(0, 8), key: str(b.key), cls: ['kr-mini-b', 'ui-edge-' + (EDGE[b.id] || 'ink')], data: { gm: 'situation', n: str(b.key) }, title: b.label });
    }).join('');
  }
  function lineNote(room) { var R = old(); return R ? R.lineNote(room) : ''; }

  /* ---------- the Rack: the Fixer's answer and Voice (the page's renderRack, rackHeadPaint and voiceHtml hand over their data) ---------- */
  function cost(size, k) { return size ? ui().chip({ label: size, cls: ['gm-fx-size', 'kr-cost', 'kr-cost-' + k] }) : ''; }
  function fxRow(row, c, hit, fxOf) {
    var o = fxOf(c[row[0]]); if (!o.lead && !o.say) return '';
    var pts = points(o.say), k = str(row[2]), last = pts.length - 1;
    /* the cost rides with the last word of the last point (one nowrap tail), so it never wraps onto a line of its own */
    var tail = function (p) { var at = p.lastIndexOf(' '); return esc(p.slice(0, at + 1)) + '<span class="kr-tail">' + esc(p.slice(at + 1)) + cost(o.size, k) + '</span>'; };
    var body = pts.map(function (p, i) { return '<li>' + (i === last && o.size ? tail(p) : esc(p)) + '</li>'; }).join('');
    if (!pts.length && o.size) body = '<li class="kr-pt-cost">' + cost(o.size, k) + '</li>';
    return '<li class="gm-fx gm-fx-' + esc(k) + (hit ? ' hit' : '') + ' kr-fx ui-edge-' + (FX_EDGE[k] || 'ink') + '">' +
      '<p class="kr-fx-h"><b class="gm-fx-k kr-fx-k">' + esc(row[1]) + '</b>' + (o.lead ? '<b class="gm-fx-lead kr-fx-lead">' + esc(o.lead) + '</b>' : '') +
        (hit ? ui().chip({ label: 'Rolled', tone: 'accent', cls: 'kr-rolled' }) : '') + '</p>' +
      (body ? '<ul class="gm-fx-t kr-pts">' + body + '</ul>' : '') + '</li>';
  }
  /* the answer reads top to bottom without scrolling. Each fit (its tok) may move the column once (a cut, never animated) just enough for the stamp's
     pinned line and the whole Blade fold to be in view above the column's sticky foot, when its lines are drawn. Never while a field in the column has the
     focus (the line after Enter, a Scene control): it waits for the focus to leave the column's fields. Never once the GM (or the page) has scrolled the
     column since the fit was asked: that fit is then left where the GM put it. Never when it is already in view */
  var rv = { tok: null, done: true, scrolled: false, self: false, want: false };
  function later(f) { if (typeof W.requestAnimationFrame === 'function') W.requestAnimationFrame(f); else W.setTimeout(f, 0); }
  function typing(doc, col) { var a = doc.activeElement; return !!(a && col.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)); }
  function watch(col) {
    if (!col || col.__krWatch) return;
    col.__krWatch = true;
    col.addEventListener('scroll', function () { if (rv.self) rv.self = false; else rv.scrolled = true; }, { passive: true });
    col.addEventListener('focusout', function () { W.setTimeout(reveal, 0); });
  }
  function arm(tok) { if (tok != null && tok !== rv.tok) rv = { tok: tok, done: false, scrolled: false, self: false, want: false }; }
  function reveal() {
    if (!W || !W.document || rv.done || !rv.want) return;
    var doc = W.document, col = doc.getElementById('gm-roll'), f = doc.getElementById('gm-rackf'), pin = doc.getElementById('kr-pin');
    if (rv.scrolled || !col || !f || !f.open || f.hidden || !drawn(doc.getElementById('gm-rl'))) { rv.done = true; return; }
    if (typing(doc, col)) return;                                    /* the focus leaving the column's fields asks again (watch) */
    rv.done = true;
    var cr = col.getBoundingClientRect(), fr = f.getBoundingClientRect(), last = col.lastElementChild, vis = cr.bottom;
    if (!fr.height || !cr.height) return;
    if (last && last !== f && W.getComputedStyle(last).position === 'sticky') vis = Math.min(vis, last.getBoundingClientRect().top);
    var pr = pin && !pin.hidden ? pin.getBoundingClientRect() : null;
    var top = Math.min(fr.top, pr && pr.height ? pr.top : fr.top) - cr.top, bottom = fr.bottom - cr.top, h = vis - cr.top;
    if (top >= 0 && bottom <= h) return;
    var dy = bottom - h + 8;
    if (bottom - top > h - 8 || top - dy < 0) dy = top - 4;
    var was = col.scrollTop; rv.self = true; col.scrollTop = was + dy;
    if (col.scrollTop === was) rv.self = false;                      /* nothing moved: no scroll event will come to clear the mark */
  }
  /* r: the page's S.rack ({ tok, ask, pre, status, why, card, hit }); ctx: { rows: FX_ROWS, why: the error line, fx: fxOf } */
  function rackHtml(r, ctx) {
    if (W && W.document) { watch(W.document.getElementById('gm-roll')); arm(r.tok); if (r.status === 'ready' && !r.hit && r.tok === rv.tok && !rv.done) { rv.want = true; later(reveal); } }
    var U = ui(), a = r.ask || { position: r.pre ? r.pre.pos : '', threat: '' }, x = ctx || {}, fx = typeof x.fx === 'function' ? x.fx : function (v) { return { lead: '', say: str(v), size: '' }; };
    var dice = [a.hhmm ? 'for ' + a.hhmm : '', str(a.position) + (a.effect ? ', ' + a.effect : '')].filter(Boolean).join(' · ');
    var line = a.threat ? a.threat : (a.stamped ? 'stamped, no line' : 'not stamped');
    var h = '<div class="gm-rack-h kr-rack-h"><p class="kr-dice gm-fx-for">' + esc(dice) + '</p>' +
      U.button({ label: 'Clear', rank: 'quiet', cls: 'kr-rclear', data: { gm: 'rackclear' }, title: 'Drops the fitted lines and the draws held for this roll' }) +
      '<p class="kr-for">' + esc(line) + '</p></div>';
    if (r.status === 'pending') h += '<p class="gm-rack-w gm-fx-wait kr-wait" role="status">Fitting…</p>';
    else if (r.status === 'error') h += '<p class="gm-rack-w gm-fx-err kr-err" role="status">' + esc(r.why || x.why || '') + '</p>' +
      (r.ask ? U.button({ label: 'Fit again', cls: 'kr-again', data: { gm: 'rackfit' } }) : '');
    else {
      var c = r.card && typeof r.card === 'object' ? r.card : {};
      if (str(c.read)) h += '<p class="gm-rack-read kr-read">' + esc(str(c.read)) + '</p>';
      h += '<ol class="gm-rack-lines gm-fx-lines kr-fxs">' + (Array.isArray(x.rows) ? x.rows : []).map(function (row) { return fxRow(row, c, r.hit === row[0], fx); }).join('') + '</ol>';
      if (r.pre && r.pre.stale) h += '<p class="gm-rack-w kr-stale">The card was drawn before something changed here; the lines above may not match it.</p>';
    }
    return '<div class="ui-card kr-rack">' + h + '</div>';
  }
  /* the hit line over the result card: row is the page's FX_ROWS entry, o the outcome as { lead, say, size } */
  function hitHtml(row, o) {
    var k = str(row[2]);
    return ui().card({ heading: 0, tag: 'div', edge: FX_EDGE[k] || 'ink', label: o.lead || '', meta: 'Blade · ' + row[1], body: o.say || '', cls: ['gm-fx-hit', 'gm-fx-' + k, 'kr-hitcard'],
      kids: o.size ? [{ part: 'chip', label: o.size, cls: ['gm-fx-size', 'kr-cost', 'kr-cost-' + k] }] : [] });
  }
  function voiceHtml(vo, can) {
    var U = ui(), who = str(vo.who), first = who.split(' ')[0], lines = Array.isArray(vo.lines) ? vo.lines : [];
    return '<div class="gm-voice ui-card ui-edge-ink kr-voice"><div class="gm-rack-h kr-rack-h"><p class="kr-dice">Voice</p>' +
        U.button({ label: 'Clear', rank: 'quiet', cls: 'kr-rclear', data: { gm: 'voiceclear' }, title: 'Drops these lines' }) +
        '<p class="kr-for"><b>' + esc(who) + '</b>' + (vo.want ? ' · ' + esc(vo.want) : '') + '</p></div>' +
      '<ul class="gm-rack-lines gm-voice-lines kr-pts">' + lines.map(function (l) { return '<li><b>' + esc(first) + '</b> ' + esc(l) + '</li>'; }).join('') + '</ul>' +
      (vo.error ? '<p class="gm-rack-w kr-err" role="status">' + esc(vo.error) + '</p>' : '') +
      (can ? U.button({ label: vo.busy ? 'Another…' : 'Another', cls: ['gm-another', 'kr-another'], data: { gm: 'another' }, disabled: !!vo.busy, title: 'One more line for this NPC, different from these' }) : '') + '</div>';
  }

  /* ---------- in and out ---------- */
  function on() { var K = W && W.B68Kit; return !!(K && typeof K.ready === 'function' && K.ready('desk') && ui() && old()); }
  function drawn(el) { return !!(el && typeof el.getAttribute === 'function' && el.getAttribute('data-kr') === '1'); }
  function mark(sec, inn) {
    var doc = sec.ownerDocument;
    [['gm-rackf', 'kr-rackf'], ['gm-rack', 'kr-rackbox'], ['gm-fxhit', 'kr-fxhit'], ['gm-mini', 'kr-mini']].forEach(function (x) { var e = doc.getElementById(x[0]); if (e && sec.contains(e)) e.classList.toggle(x[1], inn); });
    sec.classList.toggle('kr-col', inn);
  }
  function mount(sec) {
    if (!sec || typeof sec.querySelector !== 'function') return false;
    var cur = sec.querySelector('#gm-rl'); if (!cur) return false;
    var want = on(), is = drawn(cur);
    if (want === is) return false;
    if (want) {
      var t = sec.ownerDocument.createElement('div'); t.innerHTML = card();
      var kit = t.firstChild; if (!kit) return false;
      sec.replaceChild(kit, cur); sec[KEPT] = cur;
      var fold = sec.querySelector('#gm-rackf');
      if (fold && !sec.querySelector('#kr-pin')) { var pin = sec.ownerDocument.createElement('div'); pin.id = 'kr-pin'; pin.className = 'kr-pin'; pin.setAttribute('role', 'status'); pin.hidden = true; sec.insertBefore(pin, fold); }
      ui().guardBusy(sec);
    } else {
      var p0 = sec.querySelector('#kr-pin'); if (p0) p0.parentNode.removeChild(p0);
      var back = sec[KEPT];
      if (back) sec.replaceChild(back, cur);
      else { var t2 = sec.ownerDocument.createElement('div'); t2.innerHTML = old().shell(); var fresh = t2.querySelector('#gm-rl'); if (!fresh) return false; sec.replaceChild(fresh, cur); }
      sec[KEPT] = null;
    }
    mark(sec, want);
    return true;
  }
  function follow() { var P = W && W.B68GmPage; if (P && typeof P.rollKit === 'function') { try { P.rollKit(); } catch (e) { if (W.console) W.console.error(e); } } }
  function start() {
    if (!listening && W && W.B68Kit && typeof W.B68Kit.onChange === 'function') { listening = true; W.B68Kit.onChange(function (ev) { if (ev && ev.name === 'desk') follow(); }); }
    if (W && typeof W.setTimeout === 'function') W.setTimeout(follow, 0);
  }

  M.EDGE = EDGE; M.FX_EDGE = FX_EDGE; M.points = points;
  M.on = on; M.drawn = drawn; M.mount = mount; M.start = start; M.card = card;
  M.posHtml = posHtml; M.effHtml = effHtml; M.whoHtml = whoHtml; M.stampHtml = stampHtml; M.buttonsHtml = buttonsHtml; M.miniHtml = miniHtml; M.lineNote = lineNote;
  M.costHtml = costHtml; M.cleanWords = cleanWords;
  M.rackHtml = rackHtml; M.hitHtml = hitHtml; M.voiceHtml = voiceHtml;
  /* the rest of B68GmRoll, passed through at call time */
  ['shell', 'sizeText', 'sizeLine', 'sizerHtml', 'sizerActs', 'quickActs', 'rackSummary', 'cap', 'esc', 'costBind', 'costKeep', 'costNote'].forEach(function (n) {
    M[n] = function () { var R = old(); return R && typeof R[n] === 'function' ? R[n].apply(R, arguments) : ''; };
  });
  M.EFFECTS = EFFECTS.slice();
  return M;
});
