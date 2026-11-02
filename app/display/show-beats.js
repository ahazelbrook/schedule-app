/* The brief beats (suite W0.3): stamp, spotted, keyturn, rolodex, title, wanted, ring, and the spotlight. Each registers with B68Shows
   (app/display/shows.js): a label, a fixture the look book draws, `clean` for the SERVED payload (the server's bounds, and for rolodex and
   spotlight the joined shape: revealed NPCs only), and `render` building a node with createElement and textContent. Looks come from
   app/tokens.css and app/display/shows.css. A beat leaves by itself: the display removes the node at the overlay's end (server clock).
   The fixtures use the invented cast only. Rules text never appears here. */
(function (root) {
  'use strict';
  var S = root.B68Shows;
  if (!S) return;
  var C = S.C;

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }
  function svg(doc, tag, attrs) {
    var e = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function base(env, kind, extra) {
    var doc = env.document || root.document;
    var n = el(doc, 'div', 'dp-show dp-show-' + kind + (extra ? ' ' + extra : ''));
    n.setAttribute('data-show', kind);
    if (env.reduced) n.setAttribute('data-reduced', '1');
    return { doc: doc, n: n };
  }
  function opt(o, k, v) { if (v !== undefined) o[k] = v; return o; }
  var TONES = ['ink', 'orange', 'blue', 'red'];

  /* ---- stamp: a rubber stamp thumped onto the screen ---- */
  S.register('stamp', {
    label: 'Stamp', ms: 4000, fixture: { word: 'PAID', tone: 'orange' },
    clean: function (p) { var w = C.text(p.word, 24); return w ? opt({ word: w }, 'tone', C.oneOf(p.tone, TONES)) : null; },
    render: function (p, env) {
      var b = base(env, 'stamp', 'dp-tone-' + (p.tone || 'red'));
      var word = el(b.doc, 'p', 'dp-stamp-word', p.word); b.n.appendChild(word);
      return b.n;
    }
  });

  /* ---- spotted: an eye, and a red edge ---- */
  S.register('spotted', {
    label: 'Spotted', ms: 4000, fixture: { text: 'Eyes on the door', level: 2 },
    clean: function (p) { var t = C.text(p.text, 60), l = C.whole(p.level, 1, 3); if (p.text !== undefined && p.text !== null && !t) return null; return opt(opt({}, 'text', t), 'level', l); },
    render: function (p, env) {
      var b = base(env, 'spotted', 'dp-level-' + (p.level || 1));
      var eye = svg(b.doc, 'svg', { viewBox: '0 0 120 70', class: 'dp-spotted-eye', 'aria-hidden': 'true' });
      eye.appendChild(svg(b.doc, 'path', { d: 'M4 35 C28 4 92 4 116 35 C92 66 28 66 4 35 Z', class: 'dp-eye-lid' }));
      eye.appendChild(svg(b.doc, 'circle', { cx: 60, cy: 35, r: 15, class: 'dp-eye-iris' }));
      eye.appendChild(svg(b.doc, 'circle', { cx: 60, cy: 35, r: 6, class: 'dp-eye-pupil' }));
      b.n.appendChild(eye);
      b.n.appendChild(el(b.doc, 'p', 'dp-spotted-word', 'SPOTTED'));
      if (p.text) b.n.appendChild(el(b.doc, 'p', 'dp-show-line', p.text));
      return b.n;
    }
  });

  /* ---- keyturn: a key, turning ---- */
  S.register('keyturn', {
    label: 'Turn the key', ms: 6000, fixture: { label: 'KEY-1', pc: 'Nell Arbuthnot' },
    clean: function (p) { var l = C.text(p.label, 60); if (!l) return null; var pc = C.text(p.pc, 60); return opt({ label: l }, 'pc', pc); },
    render: function (p, env) {
      var b = base(env, 'keyturn');
      var k = svg(b.doc, 'svg', { viewBox: '0 0 160 60', class: 'dp-key', 'aria-hidden': 'true' });
      k.appendChild(svg(b.doc, 'circle', { cx: 30, cy: 30, r: 20, class: 'dp-key-bow' }));
      k.appendChild(svg(b.doc, 'circle', { cx: 30, cy: 30, r: 8, class: 'dp-key-hole' }));
      k.appendChild(svg(b.doc, 'path', { d: 'M50 26 H150 V34 H138 V46 H128 V34 H112 V42 H102 V34 H50 Z', class: 'dp-key-shaft' }));
      b.n.appendChild(k);
      b.n.appendChild(el(b.doc, 'p', 'dp-show-kicker', 'Turn the key'));
      b.n.appendChild(el(b.doc, 'p', 'dp-show-head', p.label));
      if (p.pc) b.n.appendChild(el(b.doc, 'p', 'dp-show-line', p.pc));
      return b.n;
    }
  });

  /* ---- title: a card with a line and a sub-line ---- */
  S.register('title', {
    label: 'Title card', ms: 6000, fixture: { text: 'The Pelican Rooms', sub: 'Gala night' },
    clean: function (p) { var t = C.text(p.text, 80); if (!t) return null; var s = C.text(p.sub, 120); return opt({ text: t }, 'sub', s); },
    render: function (p, env) {
      var b = base(env, 'title');
      b.n.appendChild(el(b.doc, 'p', 'dp-title-text', p.text));
      if (p.sub) b.n.appendChild(el(b.doc, 'p', 'dp-show-line', p.sub));
      return b.n;
    }
  });

  /* ---- wanted: the poster, with the level in stars and (optionally) the heat ---- */
  S.register('wanted', {
    label: 'Wanted', ms: 7000, fixture: { level: 3, heat: 7, siren: true },
    clean: function (p) {
      var l = C.whole(p.level, 0, 4); if (l === undefined) return null;
      var out = opt({ level: l }, 'heat', C.whole(p.heat, 0, 9)); if (p.siren === true) out.siren = true; return out;
    },
    render: function (p, env) {
      var b = base(env, 'wanted', p.siren ? 'dp-siren' : '');
      b.n.appendChild(el(b.doc, 'p', 'dp-wanted-word', 'WANTED'));
      var stars = el(b.doc, 'p', 'dp-wanted-stars'); stars.setAttribute('aria-label', 'Wanted level ' + p.level + ' of 4');
      for (var i = 0; i < 4; i++) stars.appendChild(el(b.doc, 'span', 'dp-star' + (i < p.level ? ' dp-star-on' : ''), '★'));
      b.n.appendChild(stars);
      if (p.heat !== undefined) b.n.appendChild(el(b.doc, 'p', 'dp-show-line', 'Heat ' + p.heat));
      return b.n;
    }
  });

  /* ---- ring: the phone ---- */
  S.register('ring', {
    label: 'Ring', ms: 5000, fixture: { text: 'The desk phone' },
    clean: function (p) { var t = C.text(p.text, 60); if (p.text !== undefined && p.text !== null && !t) return null; return opt({}, 'text', t); },
    render: function (p, env) {
      var b = base(env, 'ring');
      var ph = svg(b.doc, 'svg', { viewBox: '0 0 100 80', class: 'dp-phone', 'aria-hidden': 'true' });
      ph.appendChild(svg(b.doc, 'path', { d: 'M8 30 C30 6 70 6 92 30 L82 40 C70 28 30 28 18 40 Z', class: 'dp-phone-handset' }));
      ph.appendChild(svg(b.doc, 'rect', { x: 18, y: 44, width: 64, height: 28, rx: 5, class: 'dp-phone-body' }));
      ph.appendChild(svg(b.doc, 'circle', { cx: 50, cy: 58, r: 8, class: 'dp-phone-dial' }));
      b.n.appendChild(ph);
      b.n.appendChild(el(b.doc, 'p', 'dp-show-head', 'Ringing'));
      if (p.text) b.n.appendChild(el(b.doc, 'p', 'dp-show-line', p.text));
      return b.n;
    }
  });

  /* ---- rolodex and spotlight: SERVED payloads, joined to revealed NPCs only ---- */
  function cards(list, max) {
    if (!Array.isArray(list)) return null;
    var out = list.map(C.card).filter(Boolean).slice(0, max);
    return out.length ? out : null;
  }
  S.register('rolodex', {
    label: 'Rolodex', ms: 10000, fixture: { npcs: [
      { npcId: 'n-mabel', name: 'Mabel Quist', role: 'Fixer', faction: 'The Kestrel Club' },
      { npcId: 'n-dov', name: 'Dov Kessler', role: 'Desk sergeant', faction: 'The Tidewater Watch' },
      { npcId: 'n-ada', name: 'Ada Vell', role: 'Croupier', faction: 'The Kestrel Club' }] },
    clean: function (p) { var l = cards(p.npcs, 12); return l ? { npcs: l } : null; },
    render: function (p, env) {
      var b = base(env, 'rolodex', 'dp-count-' + Math.min(p.npcs.length, 6));
      b.n.appendChild(el(b.doc, 'p', 'dp-show-kicker', 'Previously, in the file'));
      var row = el(b.doc, 'div', 'dp-roll');
      p.npcs.forEach(function (c, i) {
        var card = el(b.doc, 'div', 'dp-roll-card'); card.style.setProperty('--i', String(i));
        card.appendChild(el(b.doc, 'p', 'dp-roll-mono', c.name.charAt(0)));
        card.appendChild(el(b.doc, 'p', 'dp-roll-name', c.name));
        var sub = [c.role, c.faction].filter(Boolean).join(' · ');
        if (sub) card.appendChild(el(b.doc, 'p', 'dp-roll-sub', sub));
        row.appendChild(card);
      });
      b.n.appendChild(row);
      return b.n;
    }
  });
  S.register('spotlight', {
    label: 'Spotlight', ms: 8000, fixture: { npc: { npcId: 'n-lotte', name: 'Lotte Brand', role: 'Doorwoman', faction: 'The Kestrel Club' } },
    clean: function (p) { var c = C.card(p.npc); return c ? { npc: c } : null; },
    render: function (p, env) {
      var b = base(env, 'spotlight'), c = p.npc;
      b.n.appendChild(el(b.doc, 'div', 'dp-spot-beam'));
      b.n.appendChild(el(b.doc, 'p', 'dp-roll-mono dp-spot-mono', c.name.charAt(0)));
      b.n.appendChild(el(b.doc, 'p', 'dp-show-head', c.name));
      if (c.alias) b.n.appendChild(el(b.doc, 'p', 'dp-roll-sub', '“' + c.alias + '”'));
      var sub = [c.role, c.faction].filter(Boolean).join(' · ');
      if (sub) b.n.appendChild(el(b.doc, 'p', 'dp-show-line', sub));
      return b.n;
    }
  });
})(typeof self !== 'undefined' ? self : this);
