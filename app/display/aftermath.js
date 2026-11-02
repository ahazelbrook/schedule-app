/* The Aftermath show on the table display (suite 1.6, switch spine.aftermath): two show kinds for the B05 registry (app/display/shows.js).
     aftermath  one card per step of the Run Sheet's Aftermath: payout, tithe, heat, status, harm, unwind, xp. The GM steers it (Next, Back, Skip) and each step
                is its own overlay, so a step ends by the server's clock like any beat. The look book draws one card per step (`fixtures`).
     credits    the end credits: every REVEALED NPC met tonight, in the opening card's layout (a dark ground, four coloured bars, names set in the poster face).
                A SERVED payload, like the rolodex: { npcs: [{ npcId, name, role, faction }] }, joined by the Worker to revealed NPCs only; clean() refuses any other shape.
   Looks come from app/tokens.css and app/display/aftermath.css. Every string reaches the page by textContent. The numbers and the words are whatever the GM page sent,
   which read them from the rules part at runtime; nothing from a rulebook is in this file. The fixtures use the invented cast only (the Pelican Rooms). */
(function (root) {
  'use strict';
  var S = root.B68Shows;
  if (!S) return;
  var C = S.C;

  var STEPS = ['payout', 'tithe', 'heat', 'status', 'harm', 'unwind', 'xp'];
  var HEAD = { payout: 'The payout', tithe: 'The tithe', heat: 'Heat', status: 'Status', harm: 'Harm', unwind: 'Unwind', xp: 'Commendations' };
  var BARS = ['blue', 'mustard', 'alarm', 'green'];

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }
  function put(o, k, v) { if (v !== undefined) o[k] = v; return o; }
  function lines(v) {
    if (!Array.isArray(v)) return undefined;
    var out = v.slice(0, 6).map(function (x) { return C.text(x, 80); }).filter(function (x) { return x !== undefined; });
    return out.length ? out : undefined;
  }

  function cleanAftermath(p) {
    var step = C.oneOf(p.step, STEPS);
    if (!step) return null;
    var o = { step: step };
    put(o, 'n', C.whole(p.n, 1, 8)); put(o, 'stacks', C.whole(p.stacks, 0, 99)); put(o, 'tithe', C.whole(p.tithe, 0, 99)); put(o, 'kept', C.whole(p.kept, 0, 99));
    put(o, 'exposure', C.whole(p.exposure, 0, 6)); put(o, 'mods', C.whole(p.mods, -6, 6)); put(o, 'heat', C.whole(p.heat, 0, 9)); put(o, 'after', C.whole(p.after, 0, 9));
    if (p.siren === true) o.siren = true;
    put(o, 'wanted', C.whole(p.wanted, 0, 4)); put(o, 'lines', lines(p.lines));
    put(o, 'who', C.text(p.who, 60)); put(o, 'line', C.text(p.line, 120)); put(o, 'secs', C.whole(p.secs, 10, 180));
    return o;
  }

  /* the number counts up to its value (a few frames; none when motion is reduced or there is no timer) */
  function countUp(node, to, env) {
    node.textContent = String(to);
    if (env.reduced || to < 2 || typeof root.setInterval !== 'function') return;
    var n = 0, steps = Math.min(to, 24);
    node.textContent = '0';
    var t = root.setInterval(function () {
      n++;
      node.textContent = String(Math.round(to * n / steps));
      if (n >= steps) root.clearInterval(t);
    }, 50);
  }

  var STEP_BODY = {
    payout: function (b, p, env) {
      var row = el(b.doc, 'div', 'dp-aft-stacks'); row.setAttribute('aria-hidden', 'true');
      var shown = Math.min(p.stacks || 0, 30);
      for (var i = 0; i < shown; i++) { var s = el(b.doc, 'i', 'dp-aft-stack'); s.style.setProperty('--i', String(i)); row.appendChild(s); }
      b.n.appendChild(row);
      var big = el(b.doc, 'p', 'dp-aft-big'); countUp(big, p.stacks || 0, env); b.n.appendChild(big);
      b.n.appendChild(el(b.doc, 'p', 'dp-show-line', (p.stacks === 1 ? 'stack' : 'stacks') + ' for the crew'));
    },
    tithe: function (b, p) {
      b.n.appendChild(el(b.doc, 'p', 'dp-aft-big dp-aft-minus', '−' + (p.tithe || 0)));
      b.n.appendChild(el(b.doc, 'p', 'dp-show-line', 'to the tithe'));
      if (p.kept !== undefined) b.n.appendChild(el(b.doc, 'p', 'dp-aft-kept', 'The crew keeps ' + p.kept));
    },
    heat: function (b, p, env) {
      var meter = el(b.doc, 'div', 'dp-aft-meter'); meter.setAttribute('role', 'img');
      var level = p.siren ? 9 : (p.after !== undefined ? p.after : p.heat || 0);
      meter.setAttribute('aria-label', 'Heat ' + level + ' of 9');
      for (var i = 0; i < 9; i++) { var pip = el(b.doc, 'i', 'dp-aft-pip' + (i < level ? ' on' : '')); pip.style.setProperty('--i', String(i)); meter.appendChild(pip); }
      b.n.appendChild(meter);
      var parts = [];
      if (p.exposure !== undefined) parts.push('Exposure ' + p.exposure);
      if (p.mods) parts.push((p.mods > 0 ? '+' : '−') + Math.abs(p.mods) + ' modifiers');
      if (parts.length) b.n.appendChild(el(b.doc, 'p', 'dp-aft-big', parts.join('  ')));
      if (p.heat !== undefined) b.n.appendChild(el(b.doc, 'p', 'dp-show-line', 'Heat was ' + p.heat + (p.siren ? ', now 9' : p.after !== undefined ? ', now ' + p.after : '')));
      if (p.siren && S.has('wanted')) {
        /* the siren, then WANTED: the existing beat laid over this card after the meter fills */
        S.mount({ kind: 'wanted', payload: { level: p.wanted === undefined ? 1 : p.wanted, heat: 9, siren: true } }, env).then(function (w) {
          if (!w) return;
          w.classList.add('dp-aft-siren');
          b.n.appendChild(w);
          var show = function () { w.classList.add('dp-ov-in'); };
          if (env.reduced || typeof root.setTimeout !== 'function') show(); else root.setTimeout(show, 1600);
        });
      }
    },
    list: function (b, p, none) {
      var ul = el(b.doc, 'ul', 'dp-aft-lines');
      if (p.lines && p.lines.length) p.lines.forEach(function (t, i) { var li = el(b.doc, 'li', 'dp-aft-line', t); li.style.setProperty('--i', String(i)); ul.appendChild(li); });
      else ul.appendChild(el(b.doc, 'li', 'dp-aft-line dp-aft-none', none));
      b.n.appendChild(ul);
    },
    unwind: function (b, p) {
      b.n.appendChild(el(b.doc, 'p', 'dp-show-kicker', 'Whose turn to decide'));
      b.n.appendChild(el(b.doc, 'p', 'dp-aft-big dp-aft-who', p.who || 'The table'));
      if (p.line) b.n.appendChild(el(b.doc, 'p', 'dp-show-line', p.line));
    },
    xp: function (b, p) {
      b.n.appendChild(el(b.doc, 'p', 'dp-aft-big', 'Check your sheet'));
      b.n.appendChild(el(b.doc, 'p', 'dp-show-line', p.line || 'Tick the xp triggers that happened tonight'));
      var bar = el(b.doc, 'div', 'dp-aft-clock'); bar.setAttribute('aria-hidden', 'true');
      bar.style.setProperty('--secs', String(p.secs || 90) + 's');
      bar.appendChild(el(b.doc, 'i', 'dp-aft-clock-fill'));
      b.n.appendChild(bar);
    }
  };

  S.register('aftermath', {
    label: 'Aftermath', ms: 60000,
    fixture: { step: 'payout', n: 1, stacks: 14 },
    fixtures: [
      { label: 'Aftermath: payout', fixture: { step: 'payout', n: 1, stacks: 14 } },
      { label: 'Aftermath: tithe', fixture: { step: 'tithe', n: 2, tithe: 3, kept: 11 } },
      { label: 'Aftermath: heat and the siren', fixture: { step: 'heat', n: 3, exposure: 4, mods: 2, heat: 5, after: 0, siren: true, wanted: 2 } },
      { label: 'Aftermath: status', fixture: { step: 'status', n: 4, lines: ['The Kestrel Club +1', 'The Tidewater Watch −1'] } },
      { label: 'Aftermath: harm', fixture: { step: 'harm', n: 5, lines: ['Nell Arbuthnot: a bad leg slows the next job'] } },
      { label: 'Aftermath: unwind', fixture: { step: 'unwind', n: 6, who: 'Nell Arbuthnot', line: 'Spend your downtime first' } },
      { label: 'Aftermath: commendations', fixture: { step: 'xp', n: 7, secs: 90, line: 'Tick the xp triggers that happened tonight' } }
    ],
    clean: cleanAftermath,
    render: function (p, env) {
      var doc = env.document || root.document;
      var n = el(doc, 'div', 'dp-show dp-show-aftermath dp-aft-' + p.step);
      n.setAttribute('data-show', 'aftermath'); n.setAttribute('data-step', p.step);
      if (env.reduced) n.setAttribute('data-reduced', '1');
      var b = { doc: doc, n: n };
      n.appendChild(el(doc, 'p', 'dp-show-kicker', 'Aftermath' + (p.n ? ' · ' + p.n + ' of 8' : '')));
      n.appendChild(el(doc, 'p', 'dp-show-head', HEAD[p.step]));
      if (p.step === 'status') STEP_BODY.list(b, p, 'No status changes');
      else if (p.step === 'harm') STEP_BODY.list(b, p, 'No harm complications');
      else STEP_BODY[p.step](b, p, env);
      return n;
    }
  });

  S.register('credits', {
    label: 'End credits', ms: 60000,
    fixture: { npcs: [
      { npcId: 'n-mabel', name: 'Mabel Quist', role: 'Fixer', faction: 'The Kestrel Club' },
      { npcId: 'n-dov', name: 'Dov Kessler', role: 'Desk sergeant', faction: 'The Tidewater Watch' },
      { npcId: 'n-ada', name: 'Ada Vell', role: 'Croupier', faction: 'The Kestrel Club' },
      { npcId: 'n-lotte', name: 'Lotte Brand', role: 'Doorwoman', faction: 'The Kestrel Club' },
      { npcId: 'n-hob', name: 'Hob Tamsin', role: 'Cloakroom attendant', faction: '' }] },
    clean: function (p) {
      if (!Array.isArray(p.npcs)) return null;
      var l = p.npcs.map(C.card).filter(Boolean).slice(0, 30);
      return l.length ? { npcs: l } : null;
    },
    render: function (p, env) {
      var doc = env.document || root.document;
      var n = el(doc, 'div', 'dp-show dp-show-credits dp-count-' + Math.min(p.npcs.length, 12));
      n.setAttribute('data-show', 'credits');
      if (env.reduced) n.setAttribute('data-reduced', '1');
      var bars = el(doc, 'div', 'dp-cr-bars'); bars.setAttribute('aria-hidden', 'true');
      BARS.forEach(function (c) { bars.appendChild(el(doc, 'i', 'dp-cr-bar dp-cr-' + c)); });
      n.appendChild(bars);
      n.appendChild(el(doc, 'p', 'dp-show-kicker', 'Seen tonight'));
      var cols = el(doc, 'div', 'dp-cr-cols');
      p.npcs.forEach(function (c, i) {
        var row = el(doc, 'div', 'dp-cr-row dp-cr-' + BARS[i % BARS.length]); row.style.setProperty('--i', String(i));
        row.appendChild(el(doc, 'p', 'dp-cr-name', c.name));
        var sub = [c.role, c.faction].filter(Boolean).join(' · ');
        if (sub) row.appendChild(el(doc, 'p', 'dp-cr-role', sub));
        cols.appendChild(row);
      });
      n.appendChild(cols);
      return n;
    }
  });
})(typeof self !== 'undefined' ? self : this);
