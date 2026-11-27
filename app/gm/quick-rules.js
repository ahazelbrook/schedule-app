/* gm/quick-rules.js: the quick rules (gm.glance, RK22 of the room key build). In the gm-glance bundle (app/routes.js), fetched only while its setting is on.
   Plain script, UMD: window.B68GmQuickRules in the browser, module.exports under Node. ES5, as the files beside it. It defines the global when it loads and
   reads other modules (B68Ui, B68Rules, B68Content, B68GmAftermath) only when called.

   THE RULE OF THIS FILE (Gate 0 ruling 1): there is no rules part and NO BOOK TEXT here. What an action means, and the engagement and Indulge Vice rules in
   the book's own words, come from B68Rules at runtime (the rules search over the rules this device holds), shown by a "rule:" chip. What is in the code is
   short neutral labels and numbers: the action names (B68Content.ACTIONS), the engagement factors Score already computes, and sums. A mechanic the app does
   not hold (the base dice of an engagement roll, the plan's detail) is not invented: the GM taps it, from the rule chip's text.

   WHAT IT DRAWS (every panel is one block with the class gl-rules and its own data-gl-panel; a click is a [data-gl] control, handled here)
     roll    RK22.1 Actions, RK22.4 Heat sum: under the Roll card, shut by default. An action tapped shows what the rules say it is and fills the
             Roll's own line ("If it goes wrong") with its name; the heat sum is B68GmAftermath.heatOutcome (the Aftermath's, reused) over the crew's heat,
             an exposure and a modifier, and writes nothing.
     eng     RK22.2 Engagement dice, in the Run header while the night has not started, beside the result row: the Tier gap, the district and the crew
             abilities' notes from the rolled Score (host.engage()), the plan's detail the GM taps; the net of the numbers.
     indulge RK22.3 Indulge Vice step by step, in the Downtime card: the lowest attribute, the dice, the highest die, the stress it clears, the verdict.
   STATE is this page load's only (nothing is stored, nothing reaches a phone, the display or the campaign). The one write is the Roll's own line.

   PURE (Node tests)
     ACTIONS(Content) -> [[attr, [action]]]          signedDice(n) -> '+1d' | '−1d' | '0d'        plain(md) -> one line of text
     lowestAttr(dots, Content) -> 0..4 | null        engagement(engage, adj) -> { rows, notes, net, scored }
     indulge(o) -> { dice, die, stress, left, over, steps }                heatSum(o, heatOutcome) -> { heat, exposure, mods, total, siren, wantedUp }
     pickEntry(R, term, prefer) -> Promise<{ title, caption, text } | null>
   PAGE
     rollHtml(host) engHtml(host) indulgeHtml(host) -> html           engPanel(host) indulgePanel(host) -> html in its wrapper (what the page places)
     mountRoll(host | null) -> node | null (null takes it down)       attach(doc) -> bool: the one delegated click listener ([data-gl])       repaint(kind)
     host: { rules, Content, aftermath, ui, engage(), crewHeat(), pc, redraw() } (each optional) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmQuickRules = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var EXPOSURE = [0, 2, 4, 6], DIE = [1, 2, 3, 4, 5, 6], DICE = [0, 1, 2, 3, 4];
  var TERMS = { eng: 'engagement roll', indulge: 'indulge vice', heat: 'heat' };
  var FALLBACK_ACTIONS = [['Insight', ['Hunt', 'Study', 'Survey', 'Tinker']], ['Prowess', ['Finesse', 'Prowl', 'Skirmish', 'Wreck']], ['Resolve', ['Attune', 'Command', 'Consort', 'Sway']]];
  /* this page load's state: what is open, what was tapped, what the rules said (nothing is stored) */
  var ST;
  function fresh() { return { open: { roll: '', eng: false, indulge: false }, act: '', fill: '', adj: { tier: 0, district: 0, plan: 0, tierOv: null }, heat: { exposure: 0, mods: 0, base: null }, ind: {}, rule: {}, defs: {}, loading: {}, hosts: {}, listening: false, seen: false, asked: false }; }
  ST = fresh();

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function int(v, lo, hi, d) { if (v === '' || v == null) return d; var n = Math.floor(+v); return isFinite(n) && n >= lo && n <= hi ? n : d; }
  function clamp(v, lo, hi) { var n = Math.floor(+v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
  function fold(s) { var t = str(s).toLowerCase(); try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {} return t.replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim(); }
  function signed(n) { return n > 0 ? '+' + n : n < 0 ? '−' + (-n) : '0'; }
  function signedDice(n) { return signed(n) + 'd'; }
  /* a rules entry's Markdown as one plain line: markers and links out, the words kept */
  function plain(md) {
    return str(md).replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, ' ')
      .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, '').replace(/[*_`~=]+/g, '').replace(/\s+/g, ' ').trim();
  }
  function cut(s, n) { s = str(s); if (s.length <= n) return s; var t = s.slice(0, n), sp = t.lastIndexOf(' '); return (sp > n * 0.6 ? t.slice(0, sp) : t).replace(/[\s,;:.]+$/, '') + '…'; }

  /* ---------- pure ---------- */
  function ACTIONS(Content) { var a = Content && Array.isArray(Content.ACTIONS) && Content.ACTIONS.length ? Content.ACTIONS : FALLBACK_ACTIONS; return a.filter(function (g) { return Array.isArray(g) && Array.isArray(g[1]); }); }
  /* a PC's lowest attribute: for each of Insight, Prowess and Resolve, the number of its actions with a dot; the least of the three (the tracker's attrRating) */
  function lowestAttr(dots, Content) {
    if (!isObj(dots)) return null;
    var low = null;
    ACTIONS(Content).forEach(function (g) {
      var n = g[1].filter(function (a) { return (+dots[a] || 0) > 0; }).length;
      if (low === null || n < low) low = n;
    });
    return low;
  }
  /* the engagement's numbers. engage is Score's { gap, factor, notes, district } (null: none rolled, so the tier and district are tapped); adj is the GM's taps */
  function engagement(engage, adj) {
    var a = isObj(adj) ? adj : {}, e = isObj(engage) ? engage : null, rows = [], notes = [];
    var ov = typeof a.tierOv === 'number' && isFinite(a.tierOv) ? clamp(a.tierOv, -1, 1) : null, tier = ov !== null ? ov : e ? clamp(e.factor, -1, 1) : clamp(a.tier, -1, 1), dist = e ? clamp(e.district, -6, 6) : clamp(a.district, -2, 2), plan = clamp(a.plan, -2, 2);
    rows.push({ id: 'tier', label: 'Tier gap', n: tier, tapped: true, min: -1, max: 1, note: (e ? signed(clamp(e.gap, -9, 9)) : '') + (ov !== null ? ' (note)' : '') });
    rows.push({ id: 'district', label: 'District', n: dist, tapped: !e, min: -2, max: 2, note: '' });
    rows.push({ id: 'plan', label: 'Plan detail', n: plan, tapped: true, min: -2, max: 2, note: '' });
    if (e && Array.isArray(e.notes)) e.notes.forEach(function (n) { n = str(n).trim(); if (n) notes.push(n); });
    return { rows: rows, notes: notes, net: tier + dist + plan, scored: !!e };
  }
  /* Indulge Vice: dice is the lowest attribute, die the highest die rolled (0: not rolled yet), stress what the PC carries */
  function indulge(o) {
    o = isObj(o) ? o : {};
    var dice = int(o.dice, 0, 4, null), die = int(o.die, 0, 6, 0), stress = int(o.stress, 0, 10, null), steps = [], known = !!die && stress !== null;
    var out = { dice: dice, die: die, stress: stress, left: null, over: false, steps: steps };
    if (known) { out.over = die > stress; out.left = Math.max(0, stress - die); }
    steps.push({ id: 'attr', label: 'Lowest attribute', value: dice === null ? '?' : String(dice) });
    steps.push({ id: 'roll', label: 'Roll', value: dice === null ? '?' : dice + (dice === 1 ? ' die' : ' dice') });
    steps.push({ id: 'high', label: 'Highest die', value: die ? String(die) : '?' });
    steps.push({ id: 'clear', label: 'Clears stress', value: die ? String(die) : '?' });
    steps.push({ id: 'over', label: known ? (out.over ? 'Overindulged' : 'Not overindulged') : 'Overindulge', value: known ? die + (out.over ? ' is more than ' : ' is within ') + stress : '?' });
    return out;
  }
  function heatSum(o, heatOutcome) {
    o = isObj(o) ? o : {};
    var heat = int(o.heat, 0, 9, 0), exposure = int(o.exposure, 0, 6, 0), mods = int(o.mods, -6, 6, 0);
    var r = typeof heatOutcome === 'function' ? heatOutcome(heat, exposure, mods) : null;
    if (!isObj(r)) return null;
    return { heat: heat, exposure: exposure, mods: mods, total: r.total, after: r.after, siren: !!r.siren, wantedUp: r.wantedUp || 0 };
  }
  /* the rules entry for a term: the hit whose title is the term (or starts with it), else the best hit. The text is the entry's own, as plain text */
  function pickEntry(R, term, prefer) {
    if (!R || typeof R.hits !== 'function' || typeof R.entry !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function () { return typeof R.load === 'function' ? R.load() : null; }).then(function () {
      var h = R.hits(term, 8), list = h && Array.isArray(h.hits) ? h.hits : [], low = fold(prefer || term);
      var best = list.filter(function (x) { return fold(x.title) === low; })[0] || list.filter(function (x) { return fold(x.title).indexOf(low) === 0; })[0] || list[0];
      var e = best ? R.entry(best.id) : null;
      return e && str(e.md) ? { title: str(e.title), caption: str(e.caption), text: plain(e.md) } : null;
    });
  }

  /* ---------- the page's side ---------- */
  function ui(host) { var U = (host && host.ui) || (W && W.B68Ui) || null; return U && typeof U.button === 'function' ? U : null; }
  function hostOf(kind) { return ST.hosts[kind] || null; }
  /* B68Ui parts are the only buttons here (no hand-built tag in this file), the page's own chip classes kept. Without the UI kit yet: it is asked for */
  function waiting(host) {
    if (ui(host)) return '';
    if (!ST.asked && W && W.B68Load && typeof W.B68Load.need === 'function') {
      ST.asked = true;
      W.B68Load.need('kit-ui').then(function () { ['roll', 'eng', 'indulge'].forEach(repaint); }, function () { ST.asked = false; });
    }
    return '<p class="gm-dim gl-wait">Loading the quick rules…</p>';
  }
  function btn(host, o) {
    var U = ui(host); if (!U) return '';
    return U.button({ label: o.label, rank: 'standard', cls: 'chip sm gl-b' + (o.cls ? ' ' + o.cls : ''), pressed: o.pressed, disabled: o.disabled, title: o.title, data: o.data, attrs: o.attrs });
  }
  function ctl(host, label, kind, v, extra, o) {
    o = o || {}; var d = { gl: kind }; if (v !== undefined) d.v = String(v);
    Object.keys(extra || {}).forEach(function (k) { d[k] = String(extra[k]); });
    return btn(host, { label: label, pressed: o.pressed, disabled: o.disabled, data: d, title: o.title, cls: o.cls, attrs: o.attrs });
  }
  function lab(t) { return '<span class="gm-lab gl-lab">' + esc(t) + '</span>'; }
  /* a stepper: less, the value, more (data-k the panel, data-v the number). ro: shown, not tappable (a number Score worked out) */
  function stepper(host, kind, id, label, n, lo, hi, show, ro) {
    return '<span class="gl-step" role="group" aria-label="' + esc(label) + '">' + lab(label) +
      ctl(host, '−', 'step', id, { k: kind, d: -1 }, { disabled: ro || n <= lo, attrs: { 'aria-label': 'Less ' + label }, cls: 'gl-sb' }) +
      '<output class="gl-n" aria-label="' + esc(label + ' ' + show) + '">' + esc(show) + '</output>' +
      ctl(host, '+', 'step', id, { k: kind, d: 1 }, { disabled: ro || n >= hi, attrs: { 'aria-label': 'More ' + label }, cls: 'gl-sb' }) + '</span>';
  }
  function picks(host, kind, id, label, list, cur) {
    return '<div class="gl-pick" role="group" aria-label="' + esc(label) + '">' + lab(label) +
      list.map(function (v) { return ctl(host, String(v), 'pick', v, { k: kind, id: id }, { pressed: v === cur }); }).join('') + '</div>';
  }
  function defOf(term, prefer) { var k = term + '|' + (prefer || ''); return Object.prototype.hasOwnProperty.call(ST.defs, k) ? ST.defs[k] : undefined; }
  function defHtml(d, n) {
    if (d === undefined) return '<span class="gm-dim">Looking it up…</span>';
    if (d === 'none') return '<span class="gm-dim">The rules are not available here.</span>';
    if (!d) return '<span class="gm-dim">Nothing in the rules this device holds matches.</span>';
    return '<b>' + esc(d.title) + '</b>' + (d.caption ? ' <span class="gm-dim">' + esc(d.caption) + '</span>' : '') + '<br>' + esc(cut(d.text, n || 220));
  }
  /* the "rule:" chip (the book's own words, from the rules this device holds) and the text it opens */
  function ruleBit(host, kind, term, prefer) {
    var s = ST.rule[kind + ':' + term], open = !!(s && s.open);
    var h = ctl(host, '▶ rule: ' + (prefer || term), 'rule', term, { k: kind, p: prefer || '' }, { pressed: open, cls: 'gl-rule-b', title: 'What the rules say, in the rules’ own words' });
    return open ? h + '<p class="gl-rule-t" role="status">' + defHtml(defOf(term, prefer), 900) + '</p>' : h;
  }

  /* the Roll's panel: Actions and the Heat sum */
  function actionsHtml(host) {
    var Con = (host && host.Content) || (W && W.B68Content);
    var h = '<div class="gl-body gl-acts">' + ACTIONS(Con).map(function (g) {
      return '<div class="gl-grp" role="group" aria-label="' + esc(g[0]) + '">' + lab(g[0]) +
        g[1].map(function (a) { return ctl(host, a, 'act', a, { k: 'roll' }, { pressed: ST.act === a }); }).join('') + '</div>';
    }).join('');
    if (ST.act) h += '<p class="gl-def" role="status">' + defHtml(defOf(ST.act, ST.act), 220) + '</p>' +
      '<p class="gl-note gm-dim">The Roll’s line starts with ' + esc(ST.act) + ': finish it, then Stamp.</p>' + ruleBit(host, 'roll', ST.act, ST.act);
    return h + '</div>';
  }
  function heatHtml(host) {
    var A = (host && host.aftermath) || (W && W.B68GmAftermath), fn = A && A.heatOutcome, ex = A && Array.isArray(A.EXPOSURE) ? A.EXPOSURE : EXPOSURE;
    var base = ST.heat.base === null ? clamp(host && typeof host.crewHeat === 'function' ? host.crewHeat() : 0, 0, 9) : ST.heat.base;
    var r = heatSum({ heat: base, exposure: ST.heat.exposure, mods: ST.heat.mods }, fn);
    var h = '<div class="gl-body gl-heat">';
    if (!r) return h + '<p class="gm-dim">The heat sum is not available here.</p></div>';
    h += '<div class="gl-rowx">' + stepper(host, 'roll', 'heat', 'Heat now', base, 0, 9, String(base)) + stepper(host, 'roll', 'mods', 'Modifiers', ST.heat.mods, -6, 6, signed(ST.heat.mods)) + '</div>';
    h += picks(host, 'roll', 'exposure', 'Exposure', ex, ST.heat.exposure);
    h += '<p class="gl-sum" role="status"><b>Heat ' + r.total + '</b> · ' + (r.siren ? 'Siren: Wanted up ' + r.wantedUp + ', Heat clears.' : 'No siren.') + '</p>';
    h += '<p class="gl-note gm-dim">Nothing is written: the close does that.</p>' + ruleBit(host, 'roll', TERMS.heat);
    if (ST.heat.base !== null || ST.heat.mods || ST.heat.exposure) h += ctl(host, 'Clear', 'clear', 'heat', { k: 'roll' });
    return h + '</div>';
  }
  function rollHtml(host) {
    ST.hosts.roll = host;
    var w = waiting(host); if (w) return w;
    var o = ST.open.roll;
    return '<div class="gl-bar" role="group" aria-label="Quick rules">' + lab('Quick rules') +
      ctl(host, 'Actions', 'tog', 'acts', { k: 'roll' }, { pressed: o === 'acts' }) + ctl(host, 'Heat sum', 'tog', 'heat', { k: 'roll' }, { pressed: o === 'heat' }) + '</div>' +
      (o === 'acts' ? actionsHtml(host) : o === 'heat' ? heatHtml(host) : '');
  }

  /* the Run header's engagement dice */
  function engHtml(host) {
    ST.hosts.eng = host;
    var w = waiting(host); if (w) return w;
    var e = host && typeof host.engage === 'function' ? host.engage() : null, m = engagement(e, ST.adj), open = ST.open.eng;
    var h = '<div class="gl-bar" role="group" aria-label="Engagement dice">' + lab('Engagement dice') +
      ctl(host, signedDice(m.net) + ' net', 'tog', 'eng', { k: 'eng' }, { pressed: open, title: 'The factors added up: the base dice are in the rules', attrs: { 'aria-expanded': String(open) } }) + '</div>';
    if (!open) return h;
    h += '<div class="gl-body gl-eng-b"><div class="gl-rowx">' + m.rows.map(function (r) {
      return stepper(host, 'eng', r.id, r.label + (r.note ? ' ' + r.note : ''), r.n, r.min, r.max, signedDice(r.n), !r.tapped);
    }).join('') + '</div>';
    if (m.notes.length) h += '<ul class="gl-notes">' + m.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    h += '<p class="gl-sum" role="status"><b>Net ' + signedDice(m.net) + '</b> <span class="gm-dim">' +
      (m.scored ? 'from the rolled Score, plus the plan detail you tap.' : 'no Score rolled: tap the numbers.') + ' The base dice are in the rule.</span></p>';
    h += ruleBit(host, 'eng', TERMS.eng) + (ST.adj.plan || ST.adj.tier || ST.adj.district || ST.adj.tierOv != null ? ctl(host, 'Clear', 'clear', 'eng', { k: 'eng' }) : '');
    return h + '</div>';
  }

  /* Indulge Vice, step by step, in the Downtime card */
  function pcKey(host) { var p = host && host.pc; return p && p.id ? String(p.id) : '-'; }
  function indState(host) { var k = pcKey(host); return ST.ind[k] || (ST.ind[k] = { dice: null, die: 0, stress: null }); }
  function pcDice(host) {
    var p = host && host.pc, g = p && p.glance && p.glance.play && p.glance.play.dots ? p.glance.play.dots : null;
    return lowestAttr(g, (host && host.Content) || (W && W.B68Content));
  }
  function pcStress(host) { var p = host && host.pc, s = p && p.status && typeof p.status.stress === 'number' ? p.status.stress : null; return s; }
  function indulgeHtml(host) {
    ST.hosts.indulge = host;
    var w = waiting(host); if (w) return w;
    var s = indState(host), open = ST.open.indulge;
    var dice = s.dice !== null ? s.dice : pcDice(host), stress = s.stress !== null ? s.stress : pcStress(host);
    var r = indulge({ dice: dice, die: s.die, stress: stress }), known = !!s.die && stress !== null;
    var h = '<div class="gl-bar" role="group" aria-label="Indulge Vice, step by step">' + lab('Indulge Vice') +
      ctl(host, 'Steps', 'tog', 'indulge', { k: 'indulge' }, { pressed: open, attrs: { 'aria-expanded': String(open) } }) +
      '<span class="gl-gist gm-dim">' + (known ? esc(r.over ? 'Overindulged' : 'Stress ' + stress + ' → ' + r.left) : 'lowest attribute, highest die, stress') + '</span></div>';
    if (!open) return h;
    h += '<div class="gl-body gl-ind">';
    h += picks(host, 'indulge', 'dice', 'Lowest attribute: dice', DICE, dice === null ? -1 : dice);
    h += picks(host, 'indulge', 'die', 'Highest die', DIE, s.die);
    h += stepper(host, 'indulge', 'stress', 'Stress now', stress === null ? 0 : stress, 0, 10, stress === null ? '?' : String(stress));
    h += '<ol class="gl-steps">' + r.steps.map(function (x) {
      return '<li' + (x.id === 'over' && known ? ' class="' + (r.over ? 'is-over' : 'is-ok') + '"' : '') + '><span class="gl-sl">' + esc(x.label) + '</span> <b>' + esc(x.value) + '</b></li>';
    }).join('') + '</ol>';
    h += '<p class="gl-sum" role="status">' + (known ? '<b>' + (r.over ? 'Overindulged.' : 'Not overindulged.') + '</b> ' + (r.over ? 'The Morning After is the Mishaps.' : 'The Morning After is the Benefits.') + ' ' + btn(host, { label: r.over ? 'Overindulged' : 'Indulged', data: { gm: 'dt-roll', k: 'res', v: r.over ? 'over' : 'in' }, title: 'Rolls the card as ' + (r.over ? 'overindulged' : 'indulged') + ': the same button as Rolled at the table' })
      : '<span class="gm-dim">Tap the highest die and the stress, then the Morning After roll.</span>') + '</p>';
    h += ruleBit(host, 'indulge', TERMS.indulge) + (s.dice !== null || s.die || s.stress !== null ? ctl(host, 'Clear', 'clear', 'indulge', { k: 'indulge' }) : '');
    return h + '</div>';
  }

  /* ---------- painting and the click ---------- */
  function html(kind, host) { return kind === 'roll' ? rollHtml(host) : kind === 'eng' ? engHtml(host) : kind === 'indulge' ? indulgeHtml(host) : ''; }
  function nodes(kind) { var d = W && W.document; return d ? [].slice.call(d.querySelectorAll('[data-gl-panel="' + kind + '"]')) : []; }
  /* a node's markup follows the page; focus stays on the control it was on (a click redraws what it clicked) */
  function paintNode(n, kind) {
    var host = hostOf(kind); if (!host) return;
    var h = html(kind, host); if (n.__glHtml === h) return;
    var a = W.document.activeElement, key = a && n.contains(a) && a.getAttribute ? [a.getAttribute('data-gl'), a.getAttribute('data-v'), a.getAttribute('data-id'), a.getAttribute('data-d')] : null;
    n.innerHTML = h; n.__glHtml = h;
    if (!key) return;
    var c = [].slice.call(n.querySelectorAll('[data-gl]')).filter(function (x) {
      return x.getAttribute('data-gl') === key[0] && x.getAttribute('data-v') === key[1] && x.getAttribute('data-id') === key[2] && x.getAttribute('data-d') === key[3] && !x.disabled;
    })[0];
    if (c && c.focus) { try { c.focus(); } catch (e) {} }
  }
  function repaint(kind) { nodes(kind).forEach(function (n) { paintNode(n, kind); }); }
  function need(host, kind, term, prefer) {
    var key = term + '|' + (prefer || ''), has = Object.prototype.hasOwnProperty;
    if (has.call(ST.defs, key) || ST.loading[key]) return;
    var R = (W && W.B68Rules) || (host && host.rules);      /* the page's live module first (the host was made earlier) */
    if (!R || typeof R.hits !== 'function') { ST.defs[key] = 'none'; return; }
    ST.loading[key] = true;
    pickEntry(R, term, prefer).then(function (d) { ST.defs[key] = d; delete ST.loading[key]; repaint(kind); }, function () { ST.defs[key] = null; delete ST.loading[key]; repaint(kind); });
  }
  /* an action tapped fills the Roll's line: its name and a colon at the front; a second action takes the first's place */
  function fillLine(act) {
    var d = W && W.document, t = d && d.getElementById('gm-c-threat'); if (!t) return;
    try { t.focus(); } catch (e) {}      /* while the field has the focus the page's own repaint leaves what is in it alone; it is let go of below */
    var cur = str(t.value), old = ST.fill;
    if (old && cur.indexOf(old) === 0) cur = cur.slice(old.length);
    /* a name this panel put there before (this page or an earlier one) is replaced, never stacked */
    var names = ACTIONS((W && W.B68Content) || null).reduce(function (a, g) { return a.concat(g[1]); }, []), again = true;
    while (again) { again = false; for (var i = 0; i < names.length; i++) if (cur.indexOf(names[i] + ': ') === 0) { cur = cur.slice(names[i].length + 2); again = true; break; } }
    var next = act ? act + ': ' : '', max = +t.maxLength > 0 ? +t.maxLength : 100;
    var line = (next + cur.replace(/^\s+/, '')).slice(0, max), P = W && W.B68GmPage;
    ST.fill = next; t.value = line;
    /* the page's own setter stores the line at once (the field alone is stored half a second after the last key, and a repaint in between puts the old line back) */
    if (line.trim() && P && typeof P.setThreat === 'function') { try { P.setThreat(line); } catch (e) {} t.value = line; }
    else { try { t.dispatchEvent(new W.Event('input', { bubbles: true })); } catch (e) {} }
    /* the line is stored and the field was only a means. The focus goes to the page itself, not to the chip: the page's keys (1 to 4, the letters, and Space as GO,
       which the cue stack gives to a focused body only) work from there, and a chip holding the focus would take Space for itself */
    var on = d && d.activeElement; if (on && typeof on.blur === 'function') { try { on.blur(); } catch (e) {} }
  }
  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-gl]') : null; if (!t || t.disabled) return;
    var a = t.getAttribute('data-gl'), v = t.getAttribute('data-v'), k = t.getAttribute('data-k') || '', id = t.getAttribute('data-id') || '', host = hostOf(k);
    if (a === 'tog') {
      if (k === 'roll') ST.open.roll = ST.open.roll === v ? '' : v; else ST.open[k] = !ST.open[k];
      if (k === 'roll' && ST.act && ST.open.roll === 'acts') need(host, 'roll', ST.act, ST.act);
    } else if (a === 'act') {
      ST.act = ST.act === v ? '' : v; fillLine(ST.act);
      if (ST.act) need(host, 'roll', ST.act, ST.act);
    } else if (a === 'step') {
      var d = +t.getAttribute('data-d') || 0;
      if (k === 'eng' && v === 'tier') {
        var sc = host && typeof host.engage === 'function' ? host.engage() : null, base = sc ? clamp(sc.factor, -1, 1) : null;
        if (base === null) ST.adj.tier = clamp((+ST.adj.tier || 0) + d, -1, 1);
        else { var nv = clamp((ST.adj.tierOv != null ? ST.adj.tierOv : base) + d, -1, 1); ST.adj.tierOv = nv === base ? null : nv; }      /* a crew ability's note answers the Tier die: the GM's tap, marked (note) */
      }
      else if (k === 'eng') ST.adj[v] = clamp((+ST.adj[v] || 0) + d, -2, 2);
      else if (k === 'roll' && v === 'heat') { var b = ST.heat.base === null ? clamp(host && host.crewHeat ? host.crewHeat() : 0, 0, 9) : ST.heat.base; ST.heat.base = clamp(b + d, 0, 9); }
      else if (k === 'roll' && v === 'mods') ST.heat.mods = clamp(ST.heat.mods + d, -6, 6);
      else if (k === 'indulge' && v === 'stress') { var s = indState(host), cur = s.stress !== null ? s.stress : pcStress(host); s.stress = clamp((cur === null ? 0 : cur) + d, 0, 10); }
    } else if (a === 'pick') {
      var n = +v;
      if (k === 'roll' && id === 'exposure') ST.heat.exposure = n;
      else if (k === 'indulge') { var s2 = indState(host); if (id === 'dice') s2.dice = n; else if (id === 'die') s2.die = s2.die === n ? 0 : n; }
    } else if (a === 'rule') {
      var key = k + ':' + v, prefer = t.getAttribute('data-p') || '', sr = ST.rule[key] || (ST.rule[key] = { open: false });
      sr.open = !sr.open; if (sr.open) need(host, k, v, prefer);
    } else if (a === 'clear') {
      if (v === 'heat') ST.heat = { exposure: 0, mods: 0, base: null };
      else if (v === 'eng') ST.adj = { tier: 0, district: 0, plan: 0, tierOv: null };
      else if (v === 'indulge') delete ST.ind[pcKey(host)];
    } else return;
    ev.preventDefault();
    repaint(k);
  }
  function attach(doc) {
    doc = doc || (W && W.document); if (!doc || ST.listening) return !!ST.listening;
    doc.addEventListener('click', onClick); doc.addEventListener('keyup', onKeyUp); ST.listening = true; ST.doc = doc; return true;
  }
  /* gm.glance went off on a live page (RK36): take down every panel this module mounted (the Roll card's, the Run header's engagement dice, the Downtime card's Indulge), drop both
     listeners, and forget the hosts and the state, so nothing of it is left until the setting comes back on. Only the three panels' own nodes go: the NPC search's box is its own. */
  function teardown() {
    var d = (ST && ST.doc) || (W && W.document);
    if (d && typeof d.querySelectorAll === 'function') ['roll', 'eng', 'indulge'].forEach(function (k) { [].slice.call(d.querySelectorAll('[data-gl-panel="' + k + '"]')).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); });
    if (ST && ST.listening && ST.doc && typeof ST.doc.removeEventListener === 'function') { ST.doc.removeEventListener('click', onClick); ST.doc.removeEventListener('keyup', onKeyUp); }
    ST = fresh();
  }
  /* Space is the page's GO: with the focus on one of these buttons its release would also press the button (an action chip would toggle off), so it is not let through. Enter still presses it */
  function onKeyUp(ev) {
    if ((ev.key === ' ' || ev.key === 'Spacebar') && ev.target && ev.target.closest && ev.target.closest('[data-gl]')) ev.preventDefault();
  }
  /* under the Roll card (before Blade's fold): created once, repainted when it changed; a null host takes it down */
  function mountRoll(host) {
    var d = W && W.document; if (!d) return null;
    var sec = d.getElementById('gm-roll'), n = d.querySelector('[data-gl-panel="roll"]');
    if (!host) { if (n && n.parentNode) n.parentNode.removeChild(n); return null; }
    if (!sec) return null;
    ST.hosts.roll = host; attach(d);
    if (!n) {
      n = d.createElement('div'); n.className = 'gl-rules gl-roll'; n.setAttribute('data-gl-panel', 'roll'); n.setAttribute('data-ui-scope', '');
      var at = d.getElementById('gm-rackf') || d.getElementById('gm-rl');
      if (at && at.parentNode === sec) sec.insertBefore(n, at.id === 'gm-rl' ? at.nextSibling : at); else sec.appendChild(n);
    }
    paintNode(n, 'roll');
    if (!ST.seen) { ST.seen = true; if (typeof host.redraw === 'function') host.redraw(); }
    return n;
  }
  /* the panels the Run header and the Downtime card draw are wrapped here: the wrapper carries the scope and the panel's name, and the click's listener is on */
  function wrap(kind, host, inner) { ST.hosts[kind] = host; attach(); return '<div class="gl-rules gl-' + kind + '" data-gl-panel="' + kind + '" data-ui-scope>' + inner + '</div>'; }
  function engPanel(host) { return wrap('eng', host, engHtml(host)); }
  function indulgePanel(host) { return wrap('indulge', host, indulgeHtml(host)); }
  function reset() { ST = fresh(); }

  return {
    ACTIONS: ACTIONS, signedDice: signedDice, plain: plain, lowestAttr: lowestAttr, engagement: engagement, indulge: indulge, heatSum: heatSum, pickEntry: pickEntry,
    rollHtml: rollHtml, engHtml: engHtml, indulgeHtml: indulgeHtml, engPanel: engPanel, indulgePanel: indulgePanel, mountRoll: mountRoll, attach: attach, repaint: repaint, teardown: teardown,
    fillLine: fillLine, reset: reset, onClick: onClick, onKeyUp: onKeyUp, state: function () { return ST; }
  };
});
