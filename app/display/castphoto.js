/* display/castphoto.js — the cast photo (suite ticket 3.8, switch face.castphoto): one true-height line-up of an arc's recurring cast, the people the
   crew has not met yet as silhouettes. Used by the iPad (the show kind `castphoto`) and by the GM page (its preview and the A4 print).

   Window.B68CastPhoto, and module.exports under Node. Nothing here calls a model or the network: it is deterministic drawing from data, built from the figure
   kit's own renderer (B68Figure.render), laid out the way the kit's lineup() does it (the same rig widths and gaps) with one change: each figure may be a
   silhouette on its own.

   THE SHOW KIND. The server (functions/_lib/show-castphoto.js) joins npcIds to the REVEALED NPCs only and serves { npcs: [card with spec], sil?: ['70', ...],
   title? }. A silhouette is a height in inches and nothing else: no id, no name, no drawing, so a hidden NPC reaches the display as a number. The renderer
   sets every string with textContent or escapes it into the SVG; the SVG is scrubbed again before it is put in the page.

   Pure API
     items(npcs, sil) -> [{ name, spec, h }]        the people in the photo: the met first, in the order given, then the silhouettes (name '')
     compose(items, opts) -> { svg, width, height, count, warnings }     opts: { kit (the figure kit), height (px, default 520), suffix, title }
     scrub(markup) -> markup        the SVG with scripts, foreign objects, handlers and script URLs taken out
     fit(spec) -> number            a spec's height in inches, clamped to 40-96
   render(payload, env) -> node (the show kind's renderer). */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68CastPhoto = M;
  if (root && root.B68Shows && typeof M.register === 'function') M.register(root.B68Shows);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var MAX = 30, H_MIN = 40, H_MAX = 96;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function f1(n) { return String(Math.round(n * 100) / 100); }
  function fit(spec) { var h = isObj(spec) ? num(spec.heightIn, 68) : 68; return Math.max(H_MIN, Math.min(H_MAX, Math.round(h))); }

  /* the people in the photo: the met, then the silhouettes (heights only) */
  function items(npcs, sil) {
    var out = [];
    (Array.isArray(npcs) ? npcs : []).forEach(function (c) {
      if (!isObj(c) || out.length >= MAX) return;
      var spec = isObj(c.spec) ? c.spec : null;
      out.push({ name: String(c.name == null ? '' : c.name).slice(0, 40), spec: spec, h: fit(spec) });
    });
    (Array.isArray(sil) ? sil : []).forEach(function (x) {
      var n = parseInt(x, 10);
      if (!isFinite(n) || out.length >= MAX) return;
      out.push({ name: '', spec: null, h: Math.max(H_MIN, Math.min(H_MAX, n)) });
    });
    return out;
  }

  /* an unmet figure: only the height is known, so the body is a stock one that alternates build to keep the row from looking cloned */
  function stock(h, i) { return i % 2 ? { id: 'sil-' + i, figure: 'fem', shape: 'slim', heightIn: h } : { id: 'sil-' + i, figure: 'masc', shape: 'lean', heightIn: h }; }

  function compose(list, opts) {
    var o = opts || {}, K = o.kit || (root && root.B68Figure), warnings = [];
    if (!K || typeof K.render !== 'function' || !list || !list.length) return { svg: '', width: 0, height: 0, count: 0, warnings: ['castphoto: nothing to draw'] };
    var U = K.U || 25, outH = o.height || 520, suffix = o.suffix || '';
    var tallest = Math.max.apply(null, list.map(function (it) { return it.h; }));
    var topIn = Math.max(82, Math.ceil((tallest + 6) / 2) * 2);
    var scale = outH / (topIn * U + 60);
    var rendered = list.map(function (it, i) {
      var sil = !it.spec, spec = sil ? stock(it.h, i) : it.spec;
      var r = K.render(spec, { scale: scale, suffix: suffix + '-cp' + i, pad: 0, fitShadow: false, silhouette: sil });
      (r.warnings || []).forEach(function (w) { warnings.push((sil ? 'silhouette ' + i : it.name) + ': ' + w); });
      return r;
    });
    var gap = 5 * U, side = 3 * U, x = side, groups = [], centres = [];
    rendered.forEach(function (r) {
      var sh = r.R.w.hip * 1.55 + 0.25 * r.R.hh + Math.abs(r.R.pelvisShift) * 0.5;
      var left = Math.max(-r.viewBox[0], 6 * U, sh), right = Math.max(r.viewBox[0] + r.viewBox[2], 6 * U, sh);
      x += left; groups.push('<g transform="translate(' + f1(x) + ' 0)">' + r.inner + '</g>'); centres.push(x); x += right + gap;
    });
    /* o.big (the iPad, read from 1 to 1.5 m; the GM night rebuild): the names in the label face at 24 px on two lines (the first name over the rest),
       each as large as its own space allows, and the title at 24 px. The GM page's preview and the print keep the small captions. */
    var big = o.big === true, capPx = big ? 24 : 12, titlePx = big ? 24 : 17;
    var W = x - gap + side, titleH = o.title ? (titlePx + 17) / scale : 0, capH = (big ? capPx * 2.4 + 8 : 26) / scale;
    var minY = -topIn * U - Math.max(20, 18 / scale) - titleH, bottom = 1.5 * U + capH;
    var ground = '<rect x="0" y="' + f1(minY) + '" width="' + f1(W) + '" height="' + f1(-minY + bottom) + '" fill="#e8e2d4"/>';
    var rule = '';
    [60, 72].forEach(function (inch) {
      if (inch > topIn) return;
      var y = -inch * U, t = Math.floor(inch / 12) + "'";
      rule += '<line x1="0" x2="' + f1(W) + '" y1="' + f1(y) + '" y2="' + f1(y) + '" stroke="#8e8880" stroke-width="' + f1(0.8 / scale) + '" opacity="0.7"/>' +
        '<text x="' + f1(6 / scale) + '" y="' + f1(y - 3 / scale) + '" font-family="Space Mono, monospace" font-size="' + f1(11 / scale) + '" fill="#55504a">' + t + '</text>';
    });
    var face = big ? 'Archivo Condensed, Arial Narrow, sans-serif' : 'Space Mono, monospace';
    var head = o.title ? '<text x="' + f1(W / 2) + '" y="' + f1(minY + (titlePx + 7) / scale) + '" text-anchor="middle" font-family="' + face + '" font-weight="' + (big ? 900 : 700) + '" font-size="' + f1(titlePx / scale) + '" letter-spacing="' + f1((big ? 4 : 2) / scale) + '" fill="#2a2620">' + esc(String(o.title).toUpperCase()) + '</text>' : '';
    var caps = list.map(function (it, i) {
      var name = it.name ? it.name.slice(0, big ? 40 : 18) : '?';
      if (!big) return '<text x="' + f1(centres[i]) + '" y="' + f1(1.5 * U + 16 / scale) + '" text-anchor="middle" font-family="Space Mono, monospace" font-size="' + f1(12 / scale) + '" fill="#3a352d">' + esc(name) + '</text>';
      /* the space this name has: the way to its neighbours' centres (or twice the way to the edge), and never a break inside a word */
      var room = Math.min(i > 0 ? centres[i] - centres[i - 1] : 2 * centres[i], i < centres.length - 1 ? centres[i + 1] - centres[i] : 2 * (W - centres[i])) * scale * 0.9;
      var words = name.split(' '), lines = words.length > 1 ? [words[0], words.slice(1).join(' ')] : [name];
      var longest = Math.max.apply(null, lines.map(function (l) { return l.length; }));
      var px = Math.max(10, Math.min(capPx, room / (longest * 0.74)));
      return '<text x="' + f1(centres[i]) + '" y="' + f1(1.5 * U + (px + 4) / scale) + '" text-anchor="middle" font-family="' + face + '" font-weight="900" font-size="' + f1(px / scale) + '" letter-spacing="' + f1(0.6 / scale) + '" fill="#2a2620">' +
        lines.map(function (l, k) { return '<tspan x="' + f1(centres[i]) + '"' + (k ? ' dy="1.12em"' : '') + '>' + esc(l.toUpperCase()) + '</tspan>'; }).join('') + '</text>';
    }).join('');
    var vb = [0, minY, W, -minY + bottom], count = list.length;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb.map(f1).join(' ') + '" width="' + f1(vb[2] * scale) + '" height="' + f1(vb[3] * scale) + '" role="img" aria-label="' + esc((o.title || 'Cast photo') + ': ' + count + ' people') + '">' + ground + rule + head + groups.join('') + caps + '</svg>';
    return { svg: svg, width: vb[2] * scale, height: vb[3] * scale, count: count, warnings: warnings };
  }

  /* belt and braces: our own kit drew it, but nothing script-like is ever put in the page */
  function scrub(markup) {
    return String(markup == null ? '' : markup)
      .replace(/<\s*(script|foreignObject|iframe|object|embed)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|xlink:href)\s*=\s*("\s*(javascript|data:text)[^"]*"|'\s*(javascript|data:text)[^']*')/gi, '');
  }
  function el(doc, tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null && text !== '') e.textContent = text; return e; }

  /* the node for a served payload */
  function render(p, env) {
    var doc = (env && env.document) || (root && root.document);
    var n = el(doc, 'div', 'dp-show dp-show-castphoto');
    n.setAttribute('data-show', 'castphoto');
    if (env && env.reduced) n.setAttribute('data-reduced', '1');
    var list = items(p.npcs, p.sil);
    var d = compose(list, { height: 520, suffix: '-ov', title: p.title || '', big: true });
    if (d.svg) {
      var holder = el(doc, 'div', 'dp-cp-photo');
      holder.innerHTML = scrub(d.svg);
      n.appendChild(holder);
    }
    var met = (p.npcs || []).length, un = (p.sil || []).length;
    n.appendChild(el(doc, 'p', 'dp-show-line dp-cp-count', met + (met === 1 ? ' face' : ' faces') + (un ? ' · ' + un + ' still unknown' : '')));
    return n;
  }

  function cleanPayload(C, p) {
    var npcs = Array.isArray(p.npcs) ? p.npcs.map(C.card).filter(Boolean).slice(0, MAX) : [];
    var sil = Array.isArray(p.sil) ? p.sil.filter(function (x) { return typeof x === 'string' && /^[0-9]{2,3}$/.test(x); }).slice(0, MAX - npcs.length) : [];
    if (!npcs.length && !sil.length) return null;
    var out = { npcs: npcs };
    if (sil.length) out.sil = sil;
    var t = C.text(p.title, 60); if (t) out.title = t;
    return out;
  }
  /* invented cast for the look book: heights and builds only */
  var FIXTURE = {
    title: 'The Pelican Rooms',
    npcs: [
      { npcId: 'n-mabel', name: 'Mabel Quist', role: 'Fixer', faction: 'The Kestrel Club', spec: { id: 'fx-mabel', figure: 'fem', shape: 'hourglass', heightIn: 64, skin: 'tan', age: 41 } },
      { npcId: 'n-dov', name: 'Dov Kessler', role: 'Desk sergeant', faction: 'The Tidewater Watch', spec: { id: 'fx-dov', figure: 'masc', shape: 'rect', heightIn: 73, skin: 'fair', age: 52 } },
      { npcId: 'n-lotte', name: 'Lotte Brand', role: 'Doorwoman', faction: 'The Kestrel Club', spec: { id: 'fx-lotte', figure: 'fem', shape: 'lanky', heightIn: 69, skin: 'brown', age: 33 } }
    ],
    sil: ['66', '74']
  };
  function register(S) {
    S.register('castphoto', {
      label: 'Cast photo', ms: 180000, fixture: FIXTURE,
      clean: function (p) { return cleanPayload(S.C, p); },
      render: function (p, env) { return render(p, env || {}); }
    });
  }

  return { MAX: MAX, items: items, compose: compose, scrub: scrub, fit: fit, render: render, cleanPayload: cleanPayload, register: register, FIXTURE: FIXTURE };
});
