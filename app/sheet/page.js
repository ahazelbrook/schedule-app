/* sheet/page.js: the Full sheet (phone.glance), RK32 of the room key build. The playbook's official page, filled in with the character, zoomable,
   with a small editor for each part of the page. In the phone-glance bundle (app/routes.js): boot.js fetches it only while the setting is on and
   only for a player. Nothing starts it: sheet/glance.js OPENS it (Full sheet, and as the main view over 760 px). With the setting off this file is
   never fetched and window.B68SheetPage does not exist.

   THE SEAM (agreed with RK31, sheet/glance.js lines ~24-40)
     open(container, character, opts) -> true when it will draw (it shows "Getting the sheet…" until the page arrives); false when it cannot
       (no playbook, or this playbook is known to have no sheet), and glance.js shows today's sheet. A page that learns late that it has no sheet
       or no map (a 404, a map that is not schema 1) calls opts.fallback(), remembers it, and the next open() returns false at once.
       container: glance.js's .gl-page (inside #dossier). character { doc, play, pb, own }: live getters. opts { main, focus, play(), close(),
       fallback(), record(label, before), commit(), act(name, data) }.
     update(character) -> after every redraw of the sheet while the page is up: only the mark layer (and an open editor's live part) is redrawn,
       and only when its markup changed.
   The page is fetched only when Full sheet opens: media/sheets/<playbook>.map.json, then media/sheets/<playbook>.svg (RK33's private gm:sheets
   step puts them there, from the GM's PC; the folder is gitignored and deployed from disk). Both are cached here for the visit.

   THE SHEET MAP (schema 1, written by scripts/gm-sheets.mjs; the region list is at the top of scripts/lib/sheets-map.py). Rectangles are
   [x0, y0, x1, y1] in PDF points on the page's own box; the svg's viewBox is the same box.
     header   v: 1, page (1-based), size: [w, h] (841.89 x 595.28), title, playbook (the id), kinds { region: box | dot | lozenge | clock | text | mark },
              waived: [check names] (only when not empty; 'item loads' -> items, 'key hits' -> keys, 'dots' -> acts, any other name is the region
              itself), fixed: [region keys a hand fix replaced] (only when not empty)
     stress   [rect]                      xp, xpi, xpp, xpr  [rect] (8, then 6 each)
     acts     { Action: { l: rect, d: [rect] } }               ab  [{ n, b: [rect], k: rect }]
     items    [{ n, s: [rect], l: rect, i? }] (squares = load; i = 1: a load-0 item, one box, in italics)
     stacks, bank [rect]   harm [{ level, name, label, write }]   heal rect   res [{ name, squares: [rect] }]
     keys     [{ hits: [rect], write: rect, burst: rect }]    friends [{ n, m: [rect] }]   coh { weak, impaired, broken, armor }
     id       { crew, name, alias, look, wearing, heritage, background, vice }             load { quiet, loud }
   THE GUARDS. Before a region is drawn its counts are checked against the character's playbook (app/content.js), as scripts/lib/sheets-check.mjs
   checks them at publish time: stress = the playbook's track, xp 8/6/6/6, twelve actions of 4 dots (the Vampire 5), the abilities (+ Versatile),
   every item on its own line with its load in squares, stacks 4, bank 40, six harm lines by level, four key rows of three hits, the friends. A
   region that fails, has the wrong shape, or is waived draws NOTHING and shows "This part of the sheet isn't mapped: use the glance screen". A
   wrong mark is never drawn.

   THE VIEW. A thin top bar (‹ back to the glance; the name; Table and Quiet over 700 px or held sideways; − zoom +; ⋯). The page and its marks
   sit in a scroll box that the browser pans (touch-action: pan-x pan-y); zoom is this file's own, from 100% to 400%: two pointers, Safari's
   gesturestart/gesturechange, ctrl+wheel, a double tap (fit or 250%), − and +. The box is re-laid at each size (its width changes, never a
   transform), so the vector page and the marks stay sharp; the page's viewport is untouched. A single tap on a part of the page (a whole block,
   never a 6 pt box) opens its editor: a bottom sheet on a phone, a side panel over 700 px or in landscape. The editors use tracker.js's own
   controls (data-act, data-path, data-change), so every change goes through the sheet's own handlers; a tap is recorded for Undo by glance.js's
   capture listener, and a typed change is recorded here with opts.record(label, before). Words are written in the pen face, ballpoint blue.
   Window.B68SheetPage, and module.exports under Node (checks/runtime/sheet-page.test.mjs reads the pure parts). ES5. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68SheetPage = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var V = 1, ZMIN = 1, ZMAX = 4, ZDBL = 2.5, ZSTEPS = [1, 1.5, 2, 2.5, 3, 4], TAP_MS = 300, TAP_PX = 30, WIDE = 700, BASE = 'media/sheets/';
  var NOTE = 'This part of the sheet isn’t mapped: use the glance screen';
  var TIP_KEY = 'b68.page.tip';
  var FAMILY = { 'item loads': 'items', 'key hits': 'keys', dots: 'acts' };
  var RECTS = ['stress', 'xp', 'xpi', 'xpp', 'xpr', 'stacks', 'bank'];
  var REGIONS = ['stress', 'xp', 'xpi', 'xpp', 'xpr', 'acts', 'ab', 'items', 'stacks', 'bank', 'harm', 'heal', 'res', 'keys', 'friends', 'coh', 'id', 'load'];
  var ATTRS = [['xpi', 'insight', 'Insight'], ['xpp', 'prowess', 'Prowess'], ['xpr', 'resolve', 'Resolve']];
  var LEVELS = [4, 3, 2, 2, 1, 1];

  /* ---------- pure (Node) ---------- */
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]; }); }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function isRect(r) { return Array.isArray(r) && r.length === 4 && num(r[0]) && num(r[1]) && num(r[2]) && num(r[3]) && r[2] >= r[0] && r[3] >= r[1]; }
  function rects(a) { return Array.isArray(a) && a.every(isRect); }
  function len(a) { return Array.isArray(a) ? a.length : 0; }
  function f1(n) { return String(Math.round(n * 100) / 100); }
  function norm(s) { return str(s).toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function tokens(s) { return norm(s).split(' ').filter(Boolean); }
  function subset(a, b) { return a.length > 0 && a.every(function (t) { return b.indexOf(t) >= 0; }); }
  function listText(v) { return Array.isArray(v) ? v.filter(Boolean).join(', ') : str(v); }
  function cap(s) { s = str(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function isHull(pb) { return !!(pb && pb.hull); }
  function isVamp(pb) { return !!(pb && pb.vampire); }
  function isTT(pb) { return !!(pb && pb.timetraveler); }
  function isGhost(pb) { return !!(pb && pb.ghost); }
  function stressName(pb) { return pb && pb.stressName ? pb.stressName : isHull(pb) ? 'Drain' : 'Stress'; }
  function harmName(pb) { return isHull(pb) ? 'Damage' : 'Harm'; }
  function actions(CT) { return (CT && CT.ACTIONS) || []; }

  /** The header must be schema 1 with a page size; anything else and the page is not drawn (fallback). */
  function validate(map) {
    if (!isObj(map)) return { ok: false, why: 'not an object' };
    if (map.v !== V) return { ok: false, why: 'schema ' + map.v + ', not ' + V };
    if (!Array.isArray(map.size) || map.size.length !== 2 || !(map.size[0] > 0) || !(map.size[1] > 0)) return { ok: false, why: 'no page size' };
    return { ok: true, why: '' };
  }
  /** Each region's own shape (a region in the wrong shape is drawn as nothing; the rest of the page still draws). */
  function shapeOk(k, v) {
    if (RECTS.indexOf(k) >= 0) return rects(v);
    switch (k) {
      case 'acts': return isObj(v) && Object.keys(v).every(function (a) { return isObj(v[a]) && isRect(v[a].l) && rects(v[a].d); });
      case 'ab': return Array.isArray(v) && v.every(function (a) { return isObj(a) && rects(a.b) && (a.k == null || isRect(a.k)); });
      case 'items': return Array.isArray(v) && v.every(function (a) { return isObj(a) && rects(a.s) && isRect(a.l); });
      case 'harm': return Array.isArray(v) && v.every(function (a) { return isObj(a) && num(a.level) && isRect(a.write); });
      case 'heal': return isRect(v);
      case 'res': return Array.isArray(v) && v.every(function (a) { return isObj(a) && rects(a.squares); });
      case 'keys': return Array.isArray(v) && v.every(function (a) { return isObj(a) && rects(a.hits) && isRect(a.write) && (a.burst == null || isRect(a.burst)); });
      case 'friends': return Array.isArray(v) && v.every(function (a) { return isObj(a) && rects(a.m); });
      case 'coh': case 'id': case 'load': return isObj(v) && Object.keys(v).every(function (x) { return isRect(v[x]); });
    }
    return true;
  }

  /** What the page must hold for a playbook (a port of scripts/lib/sheets-check.mjs expectFor, so the run-time guard agrees with the publish step). */
  function expect(CT, pb) {
    pb = pb || {};
    var drain = /\((\d+) boxes/.exec(str(pb.resource)), para = !!pb.paranormal;
    var own = (pb.items || []).map(function (i) { return { n: i[0], load: i[1], own: true }; });
    var items = pb.itemsRule && !own.length ? [] : own.concat(((CT && CT.STANDARD_ITEMS) || []).map(function (i) { return { n: i[0], load: i[1], own: false }; }));
    return { stress: pb.stressMax || (drain ? +drain[1] : 0) || 9, xp: 8, xpi: 6, xpp: 6, xpr: 6, acts: 12, dots: pb.maxDot || 4,
      abilities: len(pb.abilities) + (pb.fixedAbility ? 1 : 0) + (para ? 0 : 1), items: items, stacks: 4, bank: pb.bank === false ? 0 : 40,
      friends: (pb.contacts || []).map(function (c) { return Array.isArray(c) ? c.join(', ') : str(c); }), keys: 4, hits: 3, harm: 6 };
  }
  /** Each content item paired with the page line that prints it: exact names first, then a line whose words are all in the name or the other way. */
  function pairItems(lines, items) {
    var used = [], pairs = items.map(function (it) { return { item: it, line: null }; });
    function free(l) { return used.indexOf(l) < 0; }
    pairs.forEach(function (p) { var hit = (lines || []).filter(function (l) { return free(l) && norm(l.n) === norm(p.item.n); })[0]; if (hit) { p.line = hit; used.push(hit); } });
    pairs.forEach(function (p) {
      if (p.line) return; var w = tokens(p.item.n);
      var hit = (lines || []).filter(function (l) { return free(l) && (subset(tokens(l.n), w) || subset(w, tokens(l.n))); })[0]; if (hit) { p.line = hit; used.push(hit); }
    });
    return { pairs: pairs, spare: (lines || []).filter(free) };
  }
  function itemProblem(item, line) {
    if (!line) return 'no line';
    var n = len(line.s);
    if (item.own && item.load === 0) return n >= 1 && line.i ? '' : (n < 1 ? 'no box' : 'not in italics');
    return n === item.load ? '' : n + ' square(s), the data says ' + item.load;
  }
  /** The regions a map's waivers cover (a check name, mapped to its region). */
  function waivedRegions(map) { return (Array.isArray(map && map.waived) ? map.waived : []).map(function (c) { return FAMILY[c] || str(c); }); }

  /** The guard: { region: { ok, why } } for every region of the map (and the ones the playbook needs). ok false: draw nothing there, show NOTE. */
  function guards(map, CT, pb) {
    var out = {}, exp = expect(CT, pb), waived = waivedRegions(map);
    map = map || {};
    function set(k, ok, why) { out[k] = { ok: !!ok, why: ok ? '' : why }; }
    function count(k, want) { set(k, len(map[k]) === want, len(map[k]) + ' of ' + want); }
    REGIONS.forEach(function (k) {
      if (map[k] == null) { if (k !== 'coh' || (pb && pb.cohort)) set(k, false, 'not on the map'); return; }
      if (waived.indexOf(k) >= 0) { set(k, false, 'waived'); return; }
      if (!shapeOk(k, map[k])) { set(k, false, 'the wrong shape'); return; }
      switch (k) {
        case 'stress': count(k, exp.stress); return;
        case 'xp': case 'xpi': case 'xpp': case 'xpr': count(k, exp[k]); return;
        case 'stacks': count(k, exp.stacks); return;
        case 'bank': count(k, exp.bank); return;
        case 'acts': {
          var names = []; actions(CT).forEach(function (g) { names = names.concat(g[1]); });
          var ks = Object.keys(map.acts), bad = ks.filter(function (a) { return names.indexOf(a) < 0 || len(map.acts[a].d) !== exp.dots; });
          set(k, ks.length === exp.acts && !bad.length, ks.length + ' actions' + (bad.length ? ', ' + bad.join(' ') : '')); return;
        }
        case 'ab': count(k, exp.abilities); return;
        case 'items': {
          var pi = pairItems(map.items, exp.items), probs = pi.pairs.filter(function (p) { return itemProblem(p.item, p.line); });
          set(k, len(map.items) === exp.items.length && !probs.length && !pi.spare.length, probs.length + pi.spare.length + ' item line(s) disagree'); return;
        }
        case 'harm': {
          var lv = map.harm.map(function (h) { return h.level; }).sort().join(',');
          set(k, len(map.harm) === exp.harm && lv === LEVELS.slice().sort().join(','), 'levels ' + lv); return;
        }
        case 'keys': set(k, len(map.keys) === exp.keys && map.keys.every(function (r) { return len(r.hits) === exp.hits; }), 'key rows ' + map.keys.map(function (r) { return len(r.hits); }).join('/')); return;
        case 'friends': count(k, exp.friends.length); return;
        case 'res': set(k, map.res.every(function (r) { return /armou?r/i.test(str(r.name)) ? len(r.squares) >= 1 && len(r.squares) <= 2 : len(r.squares) === 2; }), 'resource boxes'); return;
        case 'coh': set(k, ['weak', 'impaired', 'broken', 'armor'].every(function (x) { return isRect(map.coh[x]); }), 'cohort boxes'); return;
        case 'load': set(k, isRect(map.load.quiet) && isRect(map.load.loud), 'load labels'); return;
        default: set(k, true, '');
      }
    });
    return out;
  }

  /* ---------- the pen ---------- */
  function para(r, sk) { var k = Math.min(sk || 1.6, (r[2] - r[0]) / 3), x0 = r[0] + .9, y0 = r[1] + .9, x1 = r[2] - .9, y1 = r[3] - .9; return '<polygon class="sp-pen" points="' + f1(x0 + k) + ',' + f1(y0) + ' ' + f1(x1) + ',' + f1(y0) + ' ' + f1(x1 - k) + ',' + f1(y1) + ' ' + f1(x0) + ',' + f1(y1) + '"/>'; }
  function circ(r) { return '<circle class="sp-pen" cx="' + f1((r[0] + r[2]) / 2) + '" cy="' + f1((r[1] + r[3]) / 2) + '" r="' + f1(Math.max(.8, Math.min(r[2] - r[0], r[3] - r[1]) / 2 - .6)) + '"/>'; }
  function sqr(r) { return '<rect class="sp-pen" x="' + f1(r[0] + 1) + '" y="' + f1(r[1] + 1) + '" width="' + f1(Math.max(.6, r[2] - r[0] - 2)) + '" height="' + f1(Math.max(.6, r[3] - r[1] - 2)) + '" rx=".8"/>'; }
  function loz(r) { var cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, d = Math.min(r[2] - r[0], r[3] - r[1]) / 2 - .7; return '<polygon class="sp-pen" points="' + f1(cx) + ',' + f1(cy - d) + ' ' + f1(cx + d) + ',' + f1(cy) + ' ' + f1(cx) + ',' + f1(cy + d) + ' ' + f1(cx - d) + ',' + f1(cy) + '"/>'; }
  function tri(r, up) { var cx = (r[0] + r[2]) / 2; return '<polygon class="sp-pen" points="' + (up ? f1(cx) + ',' + f1(r[1] + 1) + ' ' + f1(r[2] - 1) + ',' + f1(r[3] - 1) + ' ' + f1(r[0] + 1) + ',' + f1(r[3] - 1) : f1(r[0] + 1) + ',' + f1(r[1] + 1) + ' ' + f1(r[2] - 1) + ',' + f1(r[1] + 1) + ' ' + f1(cx) + ',' + f1(r[3] - 1)) + '"/>'; }
  /* words on a writing line: the pen face, squeezed (never past the line) when they would run over */
  function write(r, t) {
    t = str(t).replace(/\s+/g, ' ').trim(); if (!t) return '';
    var h = r[3] - r[1], s = Math.max(4, Math.min(9.5, h * .8)), room = r[2] - r[0] - 2, est = t.length * s * .6;
    return '<text class="sp-ink" x="' + f1(r[0] + 1) + '" y="' + f1(r[3] - Math.max(1.2, h * .18)) + '" font-size="' + f1(s) + '"' + (est > room ? ' textLength="' + f1(room) + '" lengthAdjust="spacingAndGlyphs"' : '') + '>' + esc(t) + '</text>';
  }
  function strike(r) { var y = (r[1] + r[3]) / 2; return '<line class="sp-line" x1="' + f1(r[0]) + '" y1="' + f1(y) + '" x2="' + f1(r[2]) + '" y2="' + f1(y) + '"/>'; }
  function clock(r, n) {
    n = Math.max(0, Math.min(4, +n || 0)); if (!n) return '';
    var cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, rr = Math.min(r[2] - r[0], r[3] - r[1]) / 2 - 1.5;
    if (n === 4) return '<circle class="sp-pen" cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(rr) + '"/>';
    var a1 = -Math.PI / 2, a2 = a1 + n * Math.PI / 2;
    return '<path class="sp-pen" d="M' + f1(cx) + ',' + f1(cy) + ' L' + f1(cx + rr * Math.cos(a1)) + ',' + f1(cy + rr * Math.sin(a1)) + ' A' + f1(rr) + ',' + f1(rr) + ' 0 ' + (n > 2 ? 1 : 0) + ' 1 ' + f1(cx + rr * Math.cos(a2)) + ',' + f1(cy + rr * Math.sin(a2)) + ' Z"/>';
  }
  function bbox(list) {
    var r = null; (list || []).forEach(function (x) { if (!isRect(x)) return; r = r ? [Math.min(r[0], x[0]), Math.min(r[1], x[1]), Math.max(r[2], x[2]), Math.max(r[3], x[3])] : x.slice(); });
    return r;
  }
  /** Every rectangle a region covers (for its tap target and its note). */
  function regionRects(map, k) {
    var v = map && map[k]; if (v == null || !shapeOk(k, v)) return [];
    if (k === 'heal') return [v];
    if (RECTS.indexOf(k) >= 0) return v;
    var out = [];
    switch (k) {
      case 'acts': Object.keys(v).forEach(function (a) { out.push(v[a].l); out = out.concat(v[a].d); }); break;
      case 'ab': v.forEach(function (a) { out = out.concat(a.b); if (a.k) out.push(a.k); }); break;
      case 'items': v.forEach(function (a) { out = out.concat(a.s); out.push(a.l); }); break;
      case 'harm': v.forEach(function (a) { out.push(a.write); if (isRect(a.label)) out.push(a.label); }); break;
      case 'res': v.forEach(function (a) { out = out.concat(a.squares); }); break;
      case 'keys': v.forEach(function (a) { out = out.concat(a.hits); out.push(a.write); if (a.burst) out.push(a.burst); }); break;
      case 'friends': v.forEach(function (a) { out = out.concat(a.m); }); break;
      default: Object.keys(v).forEach(function (x) { out.push(v[x]); });
    }
    return out;
  }
  function unmapped(r) {
    if (!r) return '';
    var w = r[2] - r[0], h = r[3] - r[1], s = Math.max(4, Math.min(8, h * .45, w / (NOTE.length * .5)));
    return '<g class="sp-unmapped"><rect x="' + f1(r[0] - 1) + '" y="' + f1(r[1] - 1) + '" width="' + f1(w + 2) + '" height="' + f1(h + 2) + '" rx="2"/>' +
      '<text x="' + f1(r[0] + 2) + '" y="' + f1(Math.min(r[3] - 1, r[1] + s + 2)) + '" font-size="' + f1(s) + '">' + esc(NOTE) + '</text></g>';
  }
  function sameName(a, b) { return norm(a) === norm(b); }
  /** The pen layer: the character's marks through the map, region by region, only where the guard passed; a note where it failed. */
  function marks(map, ch, g, CT) {
    var play = (ch && ch.play) || {}, pb = (ch && ch.pb) || {}, doc = (ch && ch.doc) || {}, sheet = doc.sheet || {}, h = '', notes = '';
    g = g || guards(map, CT, pb);
    function ok(k) { return !!(g[k] && g[k].ok); }
    Object.keys(g).forEach(function (k) { if (!g[k].ok) notes += unmapped(bbox(regionRects(map, k))); });
    if (ok('stress')) map.stress.forEach(function (r, i) { if (i < (+play.stress || 0)) h += para(r, 2.2); });
    var xp = play.xp || {};
    if (ok('xp')) map.xp.forEach(function (r, i) { if (i < (+xp.playbook || 0)) h += para(r); });
    ATTRS.forEach(function (a) { if (ok(a[0])) map[a[0]].forEach(function (r, i) { if (i < (+xp[a[1]] || 0)) h += para(r); }); });
    if (ok('acts')) Object.keys(map.acts).forEach(function (a) { var n = +((play.dots || {})[a]) || 0; map.acts[a].d.forEach(function (r, i) { if (i < n) h += circ(r); }); });
    if (ok('ab')) {
      var owned = Array.isArray(play.abilities) ? play.abilities : [], ticks = play.abilityTicks || {};
      map.ab.forEach(function (a) {
        var hit = owned.filter(function (n) { return sameName(n, a.n); })[0]; if (!hit) return;
        var t = Math.max(1, +ticks[hit] || 1); a.b.forEach(function (r, i) { if (i < t) h += circ(r); });
      });
    }
    if (ok('items')) {
      var carried = Array.isArray(play.items) ? play.items : [], pi = pairItems(map.items, expect(CT, pb).items);
      pi.pairs.forEach(function (p) { if (p.line && carried.indexOf(p.item.n) >= 0) p.line.s.forEach(function (r) { h += sqr(r); }); });
    }
    if (ok('stacks')) map.stacks.forEach(function (r, i) { if (i < (+play.stacks || 0)) h += loz(r); });
    if (ok('bank')) map.bank.forEach(function (r, i) { if (i < (+play.bank || 0)) h += loz(r); });
    if (ok('harm')) {
      var hm = play.harm || {}, by = { 4: [str(hm.l4)], 3: [str(hm.l3)], 2: [].concat(hm.l2 || []).map(str), 1: [].concat(hm.l1 || []).map(str) }, seen = { 1: 0, 2: 0, 3: 0, 4: 0 };
      map.harm.forEach(function (x) { var t = (by[x.level] || [])[seen[x.level]++]; h += write(x.write, t); });
    }
    if (ok('heal')) h += clock(map.heal, play.healing);
    if (ok('res')) {
      var arm = play.armor || {}, res = Array.isArray(play.resource) ? play.resource : [];
      map.res.forEach(function (x) {
        if (/armou?r/i.test(str(x.name))) { if (arm.armor && x.squares[0]) h += sqr(x.squares[0]); if (arm.heavy && x.squares[1]) h += sqr(x.squares[1]); }
        else x.squares.forEach(function (r, i) { if (res[i]) h += sqr(r); });
      });
    }
    if (ok('keys')) {
      var keys = Array.isArray(play.keys) ? play.keys : [];
      map.keys.forEach(function (row, i) {
        var k = keys[i]; if (!k) return;
        var words = str(k.name) + (k.down || k.up ? ' (▼ ' + str(k.down) + ' ▲ ' + str(k.up) + ')' : '');
        h += write(row.write, words);
        row.hits.forEach(function (r, j) { if (j < (+k.hits || 0)) h += para(r); });
        if (k.deadlock || k.glitch) { h += strike(row.write); if (row.burst) h += circ(row.burst); }
      });
    }
    if (ok('friends')) {
      var cs = Array.isArray(play.contacts) ? play.contacts : [];
      map.friends.forEach(function (f) {
        var c = cs.filter(function (x) { return x && sameName(x.name, str(f.n).split(',')[0]); })[0]; if (!c || !c.kind) return;
        var r = c.kind === 'rival' ? f.m[1] || f.m[0] : f.m[0]; if (r) h += tri(r, c.kind !== 'rival');
      });
    }
    if (ok('coh') && pb.cohort) {
      var co = play.cohort || {};
      if (co.harm && map.coh[co.harm]) h += para(map.coh[co.harm]);
      if (co.armor) h += para(map.coh.armor);
    }
    if (ok('id')) {
      var idv = { crew: play.crew, name: doc.name || sheet.name, alias: doc.alias || sheet.alias, look: sheet.look, wearing: listText(sheet.wearing), heritage: sheet.heritage, background: sheet.background, vice: play.vice };
      Object.keys(map.id).forEach(function (k) { if (idv[k] != null) h += write(map.id[k], idv[k]); });
    }
    if (ok('load')) { var L = map.load[play.loadLimit === 'loud' ? 'loud' : 'quiet']; h += '<rect class="sp-ring" x="' + f1(L[0] - 2) + '" y="' + f1(L[1] - 2) + '" width="' + f1(L[2] - L[0] + 4) + '" height="' + f1(L[3] - L[1] + 4) + '" rx="3"/>'; }
    return h + notes;
  }

  /* ---------- the tap regions: whole blocks of the page, the smallest on top ---------- */
  var TITLES = { about: 'About', stress: 'Stress and vice', keys: 'Keys', harm: 'Harm and healing', cohort: 'Cohort', abilities: 'Special abilities', friends: 'Friends',
    xp: 'Experience', stacks: 'Stacks and bank', actions: 'Actions', items: 'Load and items' };
  function pad(r, size) { var p = 4, x0 = r[0] - p, y0 = r[1] - p, x1 = r[2] + p, y1 = r[3] + p, mh = 22; if (y1 - y0 < mh) { var c = (y0 + y1) / 2; y0 = c - mh / 2; y1 = c + mh / 2; } return [Math.max(0, x0), Math.max(0, y0), Math.min(size[0], x1), Math.min(size[1], y1)]; }
  function hits(map, pb) {
    var size = (map && map.size) || [841.89, 595.28], out = [];
    function add(region, list) { var r = bbox(list); if (r) out.push({ region: region, r: pad(r, size) }); }
    add('about', regionRects(map, 'id'));
    if (map && map.id && isRect(map.id.vice)) add('stress', [map.id.vice]);
    add('stress', regionRects(map, 'stress'));
    add('keys', regionRects(map, 'keys'));
    add('harm', regionRects(map, 'harm')); add('harm', regionRects(map, 'heal')); add('harm', regionRects(map, 'res'));
    if (pb && pb.cohort) add('cohort', regionRects(map, 'coh'));
    add('abilities', regionRects(map, 'ab'));
    var fr = bbox(regionRects(map, 'friends')); if (fr) out.push({ region: 'friends', r: pad([fr[0], fr[1], Math.min(size[0] - 8, fr[2] + 150), fr[3]], size) });
    add('actions', regionRects(map, 'acts'));
    add('xp', regionRects(map, 'xp')); ATTRS.forEach(function (a) { add('xp', regionRects(map, a[0])); });
    add('stacks', regionRects(map, 'stacks').concat(regionRects(map, 'bank')));
    add('items', regionRects(map, 'items').concat(regionRects(map, 'load')));
    function area(x) { return (x.r[2] - x.r[0]) * (x.r[3] - x.r[1]); }
    return out.sort(function (a, b) { return area(b) - area(a); });
  }
  function hitsSvg(list) {
    return list.map(function (x) {
      return '<rect class="sp-hit" data-region="' + x.region + '" x="' + f1(x.r[0]) + '" y="' + f1(x.r[1]) + '" width="' + f1(x.r[2] - x.r[0]) + '" height="' + f1(x.r[3] - x.r[1]) + '" rx="5" tabindex="0" role="button" aria-label="' + esc(TITLES[x.region] + ': change') + '"><title>' + esc(TITLES[x.region]) + '</title></rect>';
    }).join('');
  }

  /* ---------- zoom maths ---------- */
  function clampZ(z) { z = +z; return !(z > 0) ? ZMIN : Math.max(ZMIN, Math.min(ZMAX, z)); }
  /** The next size for − (dir -1) or + (dir 1). */
  function stepZ(z, dir) {
    var i, eps = .01;
    if (dir > 0) { for (i = 0; i < ZSTEPS.length; i++) if (ZSTEPS[i] > z + eps) return ZSTEPS[i]; return ZMAX; }
    for (i = ZSTEPS.length - 1; i >= 0; i--) if (ZSTEPS[i] < z - eps) return ZSTEPS[i]; return ZMIN;
  }
  /** Double tap: fit, or 250% from fit. */
  function dblZ(z) { return z > 1.4 ? ZMIN : ZDBL; }
  /** Where to scroll so the point (px, py in the view) stays under the finger when the box goes from w0 to w1 wide (aspect a = h / w). */
  function keepPoint(o) {
    var a = o.aspect || 595.28 / 841.89, fx = (o.left + o.px) / o.w0, fy = (o.top + o.py) / (o.w0 * a);
    return { left: Math.max(0, fx * o.w1 - o.px), top: Math.max(0, fy * o.w1 * a - o.py) };
  }

  /* ---------- the editors: tracker.js's own controls ---------- */
  function btn(label, attrs, cls, pressed) { return '<button type="button" class="sp-btn' + (cls ? ' ' + cls : '') + '" ' + attrs + (pressed != null ? ' aria-pressed="' + !!pressed + '"' : '') + '>' + label + '</button>'; }
  function pips(n, on, attrs, label) { var h = ''; for (var i = 1; i <= n; i++) h += '<button type="button" class="sp-pip' + (i <= on ? ' sp-on' : '') + '" ' + attrs + ' data-n="' + i + '" aria-label="' + esc(label + ' ' + i) + '" aria-pressed="' + (i <= on) + '"></button>'; return '<div class="sp-pips" style="--n:' + n + '">' + h + '</div>'; }
  function field(label, path, value, ph) { return '<label class="sp-f"><span class="sp-lab">' + esc(label) + '</span><input type="text" class="sp-in" data-path="' + esc(path) + '" data-sp-l="' + esc(label) + '" value="' + esc(value) + '" placeholder="' + esc(ph || '') + '" autocomplete="off"></label>'; }
  function ro(label, value) { return '<div class="sp-f"><span class="sp-lab">' + esc(label) + '</span><span class="sp-ro">' + esc(str(value) || '—') + '</span></div>'; }
  function lab(t) { return '<div class="sp-lab sp-sec">' + esc(t) + '</div>'; }
  function maxStress(pb) { return expect(null, pb).stress; }
  function itemLoads(CT, pb, play) {
    return ((pb && pb.items) || []).concat((CT && CT.STANDARD_ITEMS) || [], ((play && play.extraItems) || []).map(function (x) { return [x.name, x.load]; }));
  }
  function loadOf(CT, pb, play) {
    var all = itemLoads(CT, pb, play), n = 0; play = play || {};
    (play.items || []).forEach(function (name) { var it = all.filter(function (x) { return x[0] === name; })[0]; n += it ? +it[1] || 0 : 0; });
    var ab = play.abilities || [], bonus = (ab.indexOf('Walking Arsenal') >= 0 ? 2 : 0) + (ab.indexOf('Retractable Arsenal') >= 0 ? 2 : 0);
    return { n: n + (+play.stacks || 0), limit: (play.loadLimit === 'loud' ? 6 : 3) + bonus, bonus: bonus };
  }
  function harmLine(k, lv, v) { return '<label class="sp-f"><span class="sp-lab">' + lv + '</span><input type="text" class="sp-in" data-sp-h="' + k + '" value="' + esc(v) + '" autocomplete="off" aria-label="' + esc('Level ' + lv) + '"></label>'; }
  function abText(list, n) { var a = list.filter(function (x) { return x[0] === n; })[0]; return a ? str(a[1]) : ''; }
  /** One region's editor: { title, sub, live (buttons, redrawn after a change), body (typed fields, drawn once), done (harm: one change) }. */
  function editor(region, ch, CT) {
    var play = (ch && ch.play) || {}, pb = (ch && ch.pb) || {}, doc = (ch && ch.doc) || {}, sheet = doc.sheet || {}, live = '', body = '', sub = '', title = TITLES[region] || '';
    switch (region) {
      case 'about':
        title = 'About ' + (doc.name || sheet.name || '');
        sub = pb.name || '';
        body = ro(isHull(pb) ? 'Designation' : 'Name', doc.name || sheet.name) + ro('Alias', doc.alias || sheet.alias) + field('Crew', 'crew', play.crew, 'Your crew') + ro('Look', sheet.look) + ro('Wearing', listText(sheet.wearing)) +
          ro(isHull(pb) ? 'Owning faction' : 'Heritage', isHull(pb) ? sheet.owning : sheet.heritage) + ro('Background', sheet.background) + '<p class="sp-faint">The GM and the creator keep these.</p>';
        break;
      case 'stress': {
        var sm = maxStress(pb), sn = stressName(pb), s = +play.stress || 0;
        title = sn + (isHull(pb) || pb.paranormal ? '' : ' and vice'); sub = s + '/' + sm;
        live = pips(sm, s, 'data-act="stress"', sn) + '<div class="sp-row">' + btn('− 1', 'data-act="stressd" data-d="-1"') + btn('+ 1', 'data-act="stressd" data-d="1"') +
          (isGhost(pb) ? btn('Consume', 'data-act="consume"') : '') + (isVamp(pb) ? btn('Feed', 'data-act="feed"') : '') + (isTT(pb) ? btn('Restabilize', 'data-act="restabilize"') : '') + '</div>';
        if (!isHull(pb) && !pb.paranormal) {
          var vices = (CT && CT.VICES) || [], opts = '<option value="">—</option>';
          vices.forEach(function (v) { opts += '<option value="' + esc(v.name) + '"' + (play.vice === v.name ? ' selected' : '') + '>' + esc(v.name) + '</option>'; });
          if (play.vice && !vices.some(function (v) { return v.name === play.vice; })) opts += '<option value="' + esc(play.vice) + '" selected>' + esc(play.vice) + '</option>';
          body = '<label class="sp-f"><span class="sp-lab">Vice</span><select class="sp-in" data-change="vice" data-sp-l="Vice">' + opts + '</select></label>' + field('Purveyor', 'purveyor', play.purveyor, 'name, place, district') +
            '<div class="sp-row">' + btn('Indulge vice', 'data-act="dtopen" data-k="indulge" data-sp-go="1"', 'sp-go') + '</div>';
        }
        break;
      }
      case 'keys': {
        var keys = Array.isArray(play.keys) ? play.keys : [];
        sub = keys.filter(function (k) { return k && k.deadlock; }).length + ' of 4 deadlocked';
        keys.forEach(function (k, i) {
          var struck = k.deadlock ? 'Deadlocked ' + (k.deadlock === 'up' ? '▲ ' + str(k.up) : '▼ ' + str(k.down)) + ' (permanent: the GM can undo it)' : k.glitch ? cap(str(k.glitch)) + ' (permanent)' : '';
          var dl = isVamp(pb) || isTT(pb) || isGhost(pb) ? '' : '<div class="sp-row">' + btn('▼ ' + esc(k.down || 'Reversed'), 'data-act="deadlock" data-i="' + i + '" data-dir="down"') + btn('▲ ' + esc(k.up || 'Intensified'), 'data-act="deadlock" data-i="' + i + '" data-dir="up"') + '</div>';
          live += '<div class="sp-key"><b>' + esc(k.name || 'Key ' + (i + 1)) + '</b>' + pips(3, +k.hits || 0, 'data-act="keyhit" data-i="' + i + '"', 'Hit') + (struck ? '<span class="sp-faint">' + esc(struck) + '</span>' : dl) + '</div>';
          body += '<div class="sp-keyw">' + field('Key ' + (i + 1), 'keys.' + i + '.name', k.name, 'name') + field('▼', 'keys.' + i + '.down', k.down, 'reversed') + field('▲', 'keys.' + i + '.up', k.up, 'intensified') + '</div>';
        });
        if (!keys.length) live = '<p class="sp-faint">No keys yet: add them on the classic sheet.</p>';
        break;
      }
      case 'harm': {
        var hm = play.harm || {}, l2 = [].concat(hm.l2 || []), l1 = [].concat(hm.l1 || []), arm = play.armor || {}, cn = isHull(pb) ? 'Repair' : 'Healing';
        title = harmName(pb) + ' and ' + cn.toLowerCase(); sub = cn + ' clock ' + (+play.healing || 0) + '/4';
        live = lab(cn + ' clock') + pips(4, +play.healing || 0, 'data-act="heal"', 'Clock') +
          lab('Armour') + '<div class="sp-row">' + btn('Armour', 'data-act="armor" data-k="armor"', '', !!arm.armor) + btn('Heavy', 'data-act="armor" data-k="heavy"', '', !!arm.heavy) + '</div>' +
          (pb.resource && !isHull(pb) ? lab(cap(pb.resource)) + '<div class="sp-row">' + [0, 1].map(function (i) { return btn(esc(cap(pb.resource)) + ' ' + (i + 1), 'data-act="resource" data-k="' + i + '"', '', !!(play.resource || [])[i]); }).join('') + '</div>' : '');
        body = harmLine('l4', 4, hm.l4) + harmLine('l3', 3, hm.l3) + harmLine('l2.0', 2, l2[0]) + harmLine('l2.1', 2, l2[1]) + harmLine('l1.0', 1, l1[0]) + harmLine('l1.1', 1, l1[1]);
        return { title: title, sub: sub, live: live, body: body, done: true };
      }
      case 'cohort': {
        var co = play.cohort || {};
        title = (pb.cohort && pb.cohort.label) || 'Cohort'; sub = co.harm ? cap(co.harm) : 'No harm';
        live = '<div class="sp-row">' + ['weak', 'impaired', 'broken'].map(function (x) { return btn(cap(x), 'data-act="coharm" data-v="' + x + '"', '', co.harm === x); }).join('') + btn('Armour', 'data-act="coarmor"', '', !!co.armor) + '</div>';
        body = field('Name', 'cohort.name', co.name) + field('Type', 'cohort.type', co.type) + field('Edges', 'cohort.edges', co.edges) + field('Flaws', 'cohort.flaws', co.flaws);
        break;
      }
      case 'abilities': {
        var mine = Array.isArray(play.abilities) ? play.abilities : [], list = (pb.abilities || []).concat(pb.fixedAbility ? [pb.fixedAbility] : []);
        sub = mine.length + ' taken · a new one at 8 playbook xp';
        live = lab('Yours') + (mine.length ? mine.map(function (n) { var t = abText(list, n); return '<div class="sp-ab"><b>' + esc(n) + '</b>' + (t ? '<span>' + esc(t) + '</span>' : '') + '</div>'; }).join('') : '<p class="sp-faint">None yet.</p>') +
          lab('Not taken yet') + list.filter(function (a) { return mine.indexOf(a[0]) < 0; }).map(function (a) { return '<div class="sp-ab sp-not"><b>' + esc(a[0]) + '</b><span>' + esc(a[1]) + '</span>' + btn('Take it', 'data-act="ability" data-n="' + esc(a[0]) + '" data-i="1"') + '</div>'; }).join('');
        break;
      }
      case 'friends': {
        var cs = Array.isArray(play.contacts) ? play.contacts : [];
        sub = 'Tap to cycle: friend, rival, neither';
        live = cs.length ? '<div class="sp-list">' + cs.map(function (c, i) { return '<button type="button" class="sp-li" data-act="contact" data-i="' + i + '"><span><b>' + esc(c.name) + '</b>' + (c.role ? ' <span>' + esc(c.role) + '</span>' : '') + '</span><span class="sp-mono">' + (c.kind === 'friend' ? '▲ friend' : c.kind === 'rival' ? '▽ rival' : '△') + '</span></button>'; }).join('') + '</div>' : '<p class="sp-faint">No friends on this sheet.</p>';
        break;
      }
      case 'xp': {
        var x = play.xp || {};
        sub = (+play.xpHold || 0) + ' to spend';
        live = lab('Playbook xp') + pips(8, +x.playbook || 0, 'data-act="xp" data-k="playbook"', 'Playbook xp');
        ATTRS.forEach(function (a) {
          var n = +x[a[1]] || 0;
          live += lab(a[2] + ' xp') + pips(6, n, 'data-act="xp" data-k="' + a[1] + '"', a[2] + ' xp');
          if (n >= 6) {
            var g = actions(CT).filter(function (t) { return t[0] === a[2]; })[0];
            live += '<div class="sp-row"><span class="sp-lab">Advance: +1 dot</span>' + (g ? g[1] : []).map(function (act) { return btn(esc(act), 'data-act="advdot" data-a="' + esc(act) + '" data-k="' + a[1] + '"'); }).join('') + '</div>';
          }
        });
        live += lab('Unspent xp') + '<div class="sp-row">' + btn('−', 'data-act="xphold" data-v="-1" aria-label="One xp off"') + '<b class="sp-mono sp-n">' + (+play.xpHold || 0) + '</b>' + btn('+', 'data-act="xphold" data-v="1" aria-label="One xp on"') + btn('Train', 'data-act="dtopen" data-k="train" data-sp-go="1"') + '</div>';
        break;
      }
      case 'stacks': {
        var tt = pb.bank === false || isTT(pb);
        sub = (+play.stacks || 0) + ' carried' + (tt ? '' : ' · ' + (+play.bank || 0) + ' banked');
        live = lab('Stacks carried') + pips(4, +play.stacks || 0, 'data-act="stacks"', 'Stacks');
        if (!tt) live += '<div class="sp-row"><b class="sp-mono sp-n">' + (+play.bank || 0) + '</b><span>in the bank, of 40</span></div><div class="sp-row">' + btn('Bank a stack', 'data-act="tobank"') + btn('Draw a stack', 'data-act="frombank"') + '</div>';
        break;
      }
      case 'actions': {
        sub = 'Tap an action to roll it';
        live = actions(CT).map(function (g) {
          var rating = g[1].filter(function (a) { return (+((play.dots || {})[a]) || 0) > 0; }).length + (isVamp(pb) && play.darkMajesty === g[0] ? 1 : 0);
          return '<div class="sp-attr"><div class="sp-row">' + lab(g[0]) + btn('Resist ' + rating + 'd', 'data-act="resistopen" data-attr="' + g[0] + '" data-sp-go="1"') + '</div>' + g[1].map(function (a) {
            var n = +((play.dots || {})[a]) || 0, m = pb.maxDot || 4, dots = ''; for (var i = 0; i < m; i++) dots += i < n ? '●' : '○';
            return '<button type="button" class="sp-li" data-act="rollopen" data-a="' + a + '" data-sp-go="1"><b>' + a + '</b><span class="sp-mono" aria-label="' + n + ' dots">' + dots + '</span></button>';
          }).join('') + '</div>';
        }).join('') + '<p class="sp-faint">Dots change only when you advance (the xp part of the page).</p>';
        break;
      }
      case 'items': {
        var ld = loadOf(CT, pb, play), loud = play.loadLimit === 'loud', carried = Array.isArray(play.items) ? play.items : [];
        sub = ld.n + '/' + ld.limit + ' load';
        live = '<div class="sp-row">' + btn('◇ ' + (3 + ld.bonus) + ' Quiet', 'data-act="limit" data-v="quiet"', '', !loud) + btn('◆ ' + (6 + ld.bonus) + ' Loud', 'data-act="limit" data-v="loud"', '', loud) +
          '<b class="sp-mono sp-n' + (ld.n > ld.limit ? ' sp-over' : '') + '">' + ld.n + '/' + ld.limit + (ld.n > ld.limit ? ' over' : '') + '</b></div>';
        live += isGhost(pb) ? '<p class="sp-faint">Your items are a note on the classic sheet.</p>' : '<div class="sp-list">' + itemLoads(CT, pb, play).map(function (it) {
          var on = carried.indexOf(it[0]) >= 0;
          return '<button type="button" class="sp-li" data-act="item" data-n="' + esc(it[0]) + '" aria-pressed="' + on + '"><span><b>' + (on ? '■ ' : '□ ') + esc(it[0]) + '</b></span><span>' + (+it[1] ? it[1] + ' load' : 'free') + '</span></button>';
        }).join('') + '</div><p class="sp-faint">A carried stack takes a load slot (' + (+play.stacks || 0) + ' now).</p>';
        break;
      }
      default: return null;
    }
    return { title: title, sub: sub, live: live, body: body, done: false };
  }

  /* ---------- the page in the browser ---------- */
  var cache = {}, cur = null;
  var FOCUS = { 'ds-keybox': 'keys', 'ds-abbox': 'abilities' };
  var EDKEYS = { about: ['id'], stress: ['stress'], keys: ['keys'], harm: ['harm', 'heal', 'res'], cohort: ['coh'], abilities: ['ab'], friends: ['friends'], xp: ['xp', 'xpi', 'xpp', 'xpr'], stacks: ['stacks', 'bank'], actions: ['acts'], items: ['items', 'load'] };
  function doc() { return W && W.document; }
  function store() { try { return W && W.localStorage ? W.localStorage : null; } catch (e) { return null; } }
  function tipHidden() { var s = store(); try { return !!s && s.getItem(TIP_KEY) === 'off'; } catch (e) { return false; } }
  function pbIdOf(ch) { var pb = ch && ch.pb, d = ch && ch.doc; return str((pb && pb.id) || (d && (d.playbook || (d.spec && d.spec.playbook)))); }
  function CTnow() { return (W && W.B68Content) || null; }

  /** The map, then the page (an <img> of the svg: no script in it can run, and the browser draws it afresh at each laid-out size). Cached. */
  function load(id) {
    var c = cache[id];
    if (c && c.p) return c.p;
    c = cache[id] = { status: 'loading', map: null, img: null, p: null };
    var F = W && W.fetch, url = BASE + encodeURIComponent(id);
    c.p = (typeof F === 'function' ? Promise.resolve(F.call(W, url + '.map.json', { credentials: 'same-origin' })) : Promise.reject(new Error('no fetch')))
      .then(function (r) { if (!r || !r.ok) throw new Error('no map (' + (r && r.status) + ')'); return r.json(); })
      .then(function (map) {
        var v = validate(map); if (!v.ok) throw new Error('map: ' + v.why);
        if (map.playbook && map.playbook !== id) throw new Error('the map is for ' + map.playbook);
        return new Promise(function (res, rej) {
          var I = W.Image; if (typeof I !== 'function') { rej(new Error('no image')); return; }
          var img = new I(); img.decoding = 'async'; img.alt = ''; img.className = 'sp-img'; img.setAttribute('aria-hidden', 'true'); img.draggable = false;
          img.onload = function () { res({ map: map, img: img }); };
          img.onerror = function () { rej(new Error('no page')); };
          img.src = url + '.svg';
        });
      })
      .then(function (got) { c.status = 'ready'; c.map = got.map; c.img = got.img; return c; }, function (e) { c.status = 'missing'; c.why = str(e && e.message); throw e; });
    return c.p;
  }

  function isWide(box) {
    var w = (box && box.clientWidth) || (W && W.innerWidth) || 0, h = (W && W.innerHeight) || 0;
    return w > WIDE || (w > h && h > 0 && h < 520);
  }
  function rootOf(box) { var n = box; while (n && n.id !== 'dossier') n = n.parentNode; return n || null; }
  function play() { return cur && cur.ch ? cur.ch.play : null; }
  function snap() { var p = play(); return p ? JSON.stringify(p) : null; }
  function titleOf(ch) { var d = (ch && ch.doc) || {}, pb = (ch && ch.pb) || {}; return (d.name || (d.sheet && d.sheet.name) || '') + (pb.name ? ' · ' + pb.name : ''); }

  function barHtml(ch, wide) {
    var r = cur.root, h = '';
    h += '<button type="button" class="sp-zb sp-back" data-sp="back" aria-label="Back to the glance screen">‹</button>';
    h += '<b class="sp-ttl">' + esc(titleOf(ch)) + '</b>';
    if (wide && r && r.querySelector('.ds-tablebtn')) h += '<button type="button" class="sp-tb" data-act="tablescreen" data-always="1" aria-haspopup="dialog">Table</button>';
    if (wide && r && r.querySelector('.ds-quietbtn')) h += '<button type="button" class="sp-tb sp-quiet" data-act="quiet" aria-haspopup="dialog">Quiet</button>';
    h += '<span class="sp-zoom"><button type="button" class="sp-zb" data-sp="out" aria-label="Zoom out">−</button>';
    h += '<span class="sp-pct sp-mono" aria-live="polite">100%</span><button type="button" class="sp-zb" data-sp="in" aria-label="Zoom in">+</button></span>';
    h += '<button type="button" class="sp-zb sp-more" data-sp="menu" aria-haspopup="true" aria-label="More">⋯</button>';
    return h;
  }
  function menuHtml() {
    var r = cur.root, h = '';
    h += btn('Glance screen', 'data-sp="back"', 'sp-mi');
    h += btn('The classic sheet (notes, log, clocks)', 'data-sp="classic"', 'sp-mi');
    if (r && r.querySelector('.ds-missionbtn')) h += btn('Mission card', 'data-act="missionscreen" data-always="1"', 'sp-mi');
    h += btn('Print', 'data-act="print" data-always="1"', 'sp-mi');
    h += btn('Back to your files', 'data-act="back" data-always="1"', 'sp-mi');
    return h;
  }
  function mount(box, ch, opts, id) {
    var D = doc();
    cur = { box: box, root: rootOf(box), ch: ch, opts: opts || {}, id: id, z: 1, ed: null, field: null, marks: null, entry: null, pend: null, wide: isWide(box) };
    box.innerHTML = '';
    var el = D.createElement('div'); el.className = 'sp' + (cur.wide ? ' sp-wide' : ''); el.setAttribute('data-sp-pb', id);
    el.innerHTML = '<div class="sp-bar">' + barHtml(ch, cur.wide) + '</div>' +
      (cur.wide || tipHidden() ? '' : '<div class="sp-tip"><span>Pinch to zoom · tap a part to change it · turn the phone for a bigger page</span><button type="button" class="sp-x" data-sp="tip" aria-label="Hide the tip">×</button></div>') +
      '<div class="sp-view" role="region" aria-label="Your playbook page"><div class="sp-box"><p class="sp-wait">Getting the sheet…</p></div></div>' +
      '<div class="sp-layer"></div><div class="sp-menu" role="menu" hidden>' + menuHtml() + '</div>';
    box.appendChild(el);
    cur.el = el; cur.view = el.querySelector('.sp-view'); cur.pbox = el.querySelector('.sp-box');
    wire(el);
  }
  function ready(entry) {
    if (!cur || !cur.el) return;
    var D = doc(), map = entry.map, size = map.size, pbox = cur.pbox;
    cur.entry = entry;
    pbox.innerHTML = '';
    pbox.appendChild(entry.img);
    var svg = D.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sp-ov'); svg.setAttribute('viewBox', '0 0 ' + size[0] + ' ' + size[1]);
    svg.innerHTML = '<g class="sp-marks" aria-hidden="true"></g><g class="sp-hits">' + hitsSvg(hits(map, cur.ch.pb)) + '</g>';
    pbox.appendChild(svg);
    cur.svg = svg; cur.marks = null;
    cur.el.classList.add('sp-ready');
    redraw();
    setZoom(1);
    var f = cur.opts.focus; if (f && FOCUS[f]) openEd(FOCUS[f], null);
  }
  function redraw() {
    if (!cur || !cur.entry || !cur.svg) return;
    var CT = CTnow(), map = cur.entry.map, g = guards(map, CT, cur.ch.pb), h = marks(map, cur.ch, g, CT);
    if (h !== cur.marks) { cur.svg.querySelector('.sp-marks').innerHTML = h; cur.marks = h; }
    var bar = cur.el.querySelector('.sp-ttl'), t = titleOf(cur.ch);
    if (bar && bar.textContent !== t) bar.textContent = t;
    foot();
    drawEd(false);
  }

  /* over 760 px the Now card is a strip at the foot (page.css): the page and a side panel end above it */
  function foot() {
    var n = cur.root && cur.root.querySelector('.ds-now'), h = 0;
    if (n && n.getClientRects && n.getClientRects().length && W.getComputedStyle && W.getComputedStyle(n).position === 'fixed') h = Math.round(n.getBoundingClientRect().height);
    var v = h ? h + 'px' : '';
    [cur.el, cur.root].forEach(function (x) {
      var s = x && x.style; if (!s || typeof s.setProperty !== 'function' || s.getPropertyValue('--sp-foot') === v) return;
      if (v) s.setProperty('--sp-foot', v); else s.removeProperty('--sp-foot');
    });
  }

  /* ---------- editors in the page ---------- */
  function edNote(region) {
    if (!cur || !cur.entry) return '';
    var g = guards(cur.entry.map, CTnow(), cur.ch.pb);
    return (EDKEYS[region] || []).some(function (k) { return g[k] && !g[k].ok; }) ? '<p class="sp-note" role="note">' + esc(NOTE) + '</p>' : '';
  }
  function openEd(region, opener) {
    if (!cur || !editor(region, cur.ch, CTnow())) return;
    closeMenu();
    cur.ed = { region: region, live: null, opener: opener || null };
    drawEd(true);
  }
  function getPath(o, p) { str(p).split('.').forEach(function (k) { o = o == null ? undefined : o[k]; }); return o; }
  function drawEd(fresh) {
    if (!cur || !cur.el) return;
    var layer = cur.el.querySelector('.sp-layer'); if (!layer) return;
    if (!cur.ed) { if (layer.firstChild) layer.innerHTML = ''; return; }
    var sp = editor(cur.ed.region, cur.ch, CTnow()); if (!sp) { cur.ed = null; layer.innerHTML = ''; return; }
    if (fresh || !layer.querySelector('.sp-panel')) {
      layer.innerHTML = (cur.wide ? '' : '<div class="sp-scrim" data-sp="close"></div>') + '<div class="sp-panel" role="dialog" aria-modal="' + !cur.wide + '" aria-labelledby="sp-ed-t" tabindex="-1" data-region="' + cur.ed.region + '">' +
        '<div class="sp-ph"><div><h3 id="sp-ed-t">' + esc(sp.title) + '</h3><small class="sp-sub">' + esc(sp.sub) + '</small></div><button type="button" class="sp-x" data-sp="close" aria-label="Close">×</button></div>' +
        '<div class="sp-pbody">' + edNote(cur.ed.region) + '<div class="sp-live">' + sp.live + '</div><div class="sp-static">' + sp.body + '</div></div>' +
        (sp.done ? '<div class="sp-pf">' + btn('Done', 'data-sp="harmdone"', 'sp-go') + btn('Cancel', 'data-sp="close"') + '</div>' : '') + '</div>';
      cur.ed.live = sp.live;
      var p = layer.querySelector('.sp-panel'); try { p.focus({ preventScroll: true }); } catch (e) { /* no focus */ }
      return;
    }
    var sub = layer.querySelector('.sp-sub'); if (sub && sub.textContent !== sp.sub) sub.textContent = sp.sub;
    if (cur.ed.live !== sp.live) { var lv = layer.querySelector('.sp-live'); if (lv) lv.innerHTML = sp.live; cur.ed.live = sp.live; }
    /* a typed field not being typed in follows the play (a change from elsewhere) */
    var a = doc().activeElement;
    Array.prototype.forEach.call(layer.querySelectorAll('input[data-path]'), function (inp) {
      if (inp === a) return; var v = str(getPath(cur.ch.play, inp.getAttribute('data-path'))); if (inp.value !== v) inp.value = v;
    });
  }
  function closeEd() {
    if (!cur) return; var o = cur.ed && cur.ed.opener; cur.ed = null; drawEd(false);
    if (o && o.isConnected) { try { o.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }
  function trimHarm(hm) { hm = hm || {}; function t(x) { return str(x).trim(); } return { l4: t(hm.l4), l3: t(hm.l3), l2: [].concat(hm.l2 || ['', '']).concat(['', '']).slice(0, 2).map(t), l1: [].concat(hm.l1 || ['', '']).concat(['', '']).slice(0, 2).map(t) }; }
  function harmDone() {
    var layer = cur.el.querySelector('.sp-layer'), p = play(); if (!p) return;
    function v(k) { var i = layer.querySelector('[data-sp-h="' + k + '"]'); return i ? i.value : ''; }
    var next = trimHarm({ l4: v('l4'), l3: v('l3'), l2: [v('l2.0'), v('l2.1')], l1: [v('l1.0'), v('l1.1')] });
    closeEd();
    if (JSON.stringify(next) === JSON.stringify(trimHarm(p.harm))) return;
    var before = snap(); p.harm = next;
    if (cur.opts.commit) cur.opts.commit();
    if (cur.opts.record) cur.opts.record(harmName(cur.ch.pb) + ' updated', before);
  }
  function openMenu() { var m = cur.el.querySelector('.sp-menu'); if (!m) return; m.hidden = !m.hidden; if (!m.hidden) { var f = m.querySelector('button'); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { /* no focus */ } } } }
  function closeMenu() { var m = cur && cur.el && cur.el.querySelector('.sp-menu'); if (m) m.hidden = true; }

  /* ---------- zoom in the browser ---------- */
  function baseW() { var v = cur.view; return Math.max(200, (v ? v.clientWidth : 360) - 16); }
  function aspect() { var s = cur.entry ? cur.entry.map.size : [841.89, 595.28]; return s[1] / s[0]; }
  function setZoom(z, px, py) {
    if (!cur || !cur.view) return;
    var v = cur.view, pbx = cur.pbox, w0 = pbx.offsetWidth || baseW() * cur.z;
    z = clampZ(z); cur.z = z;
    var w1 = baseW() * z, a = aspect();
    pbx.style.width = Math.round(w1) + 'px'; pbx.style.height = Math.round(w1 * a) + 'px';
    var k = keepPoint({ left: v.scrollLeft, top: v.scrollTop, px: px == null ? v.clientWidth / 2 : px, py: py == null ? v.clientHeight / 2 : py, w0: w0, w1: w1, aspect: a });
    v.scrollLeft = k.left; v.scrollTop = k.top;
    var pct = cur.el.querySelector('.sp-pct'); if (pct) pct.textContent = Math.round(z * 100) + '%';
    var o = cur.el.querySelector('[data-sp="out"]'), i = cur.el.querySelector('[data-sp="in"]');
    if (o) o.disabled = z <= ZMIN + .001;
    if (i) i.disabled = z >= ZMAX - .001;
    cur.el.setAttribute('data-zoom', String(Math.round(z * 100)));
  }
  function inView(e) { var r = cur.view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function wireZoom(v) {
    var pts = {}, pinch = null, moved = false, last = 0, lastXY = null, raf = 0, want = null, g0 = 1;
    function frame() { raf = 0; if (want && cur) setZoom(want[0], want[1], want[2]); want = null; }
    function soon(z, x, y) { want = [z, x, y]; if (!raf) raf = (W.requestAnimationFrame ? W.requestAnimationFrame(frame) : W.setTimeout(frame, 16)); }
    function cancelTap() { if (cur && cur.pend) { W.clearTimeout(cur.pend); cur.pend = null; } }
    v.addEventListener('pointerdown', function (e) {
      pts[e.pointerId] = [e.clientX, e.clientY, e.clientX, e.clientY]; moved = false;
      var ids = Object.keys(pts); if (ids.length === 2 && cur) { var a = pts[ids[0]], b = pts[ids[1]]; pinch = { d: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), z: cur.z }; cancelTap(); }
    });
    v.addEventListener('pointermove', function (e) {
      var p = pts[e.pointerId]; if (!p) return;
      if (Math.hypot(e.clientX - p[2], e.clientY - p[3]) > 8) moved = true;
      p[0] = e.clientX; p[1] = e.clientY;
      var ids = Object.keys(pts);
      if (ids.length === 2 && pinch) { e.preventDefault(); var a = pts[ids[0]], b = pts[ids[1]], r = v.getBoundingClientRect(); soon(pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); }
    });
    function up(e) {
      var was = Object.keys(pts).length > 1; delete pts[e.pointerId]; if (Object.keys(pts).length < 2) pinch = null;
      if (was) { last = 0; moved = true; return; }
      if (e.type !== 'pointerup' || moved || !cur) return;
      var now = Date.now(), xy = inView(e);
      if (now - last < TAP_MS + 20 && lastXY && Math.hypot(xy[0] - lastXY[0], xy[1] - lastXY[1]) < TAP_PX) { cancelTap(); last = 0; setZoom(dblZ(cur.z), xy[0], xy[1]); return; }
      last = now; lastXY = xy;
      var t = e.target && e.target.closest ? e.target.closest('.sp-hit') : null;
      cancelTap();
      if (t) { var region = t.getAttribute('data-region'); cur.pend = W.setTimeout(function () { if (cur) { cur.pend = null; openEd(region, t); } }, TAP_MS); }
    }
    v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up);
    v.addEventListener('wheel', function (e) { if (!e.ctrlKey || !cur) return; e.preventDefault(); var xy = inView(e); setZoom(cur.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), xy[0], xy[1]); }, { passive: false });
    /* Safari's own gesture events: the page never zooms itself, the sheet does */
    v.addEventListener('gesturestart', function (e) { e.preventDefault(); g0 = cur ? cur.z : 1; cancelTap(); });
    v.addEventListener('gesturechange', function (e) { e.preventDefault(); if (cur) soon(g0 * (+e.scale || 1)); });
    v.addEventListener('gestureend', function (e) { e.preventDefault(); });
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-sp]') : null;
    if (!cur || !t || !cur.el.contains(t)) {
      /* a tracker control in an editor that opens a panel of today's sheet (a roll, resist, Indulge, Train): the editor goes so the panel shows */
      var go = e.target && e.target.closest ? e.target.closest('[data-sp-go]') : null;
      if (go && cur) W.setTimeout(closeEd, 0);
      var mi = e.target && e.target.closest ? e.target.closest('.sp-menu [data-act]') : null;
      if (mi) W.setTimeout(closeMenu, 0);
      return;
    }
    var k = t.getAttribute('data-sp'), o = cur.opts;
    switch (k) {
      case 'back': closeEd(); closeMenu(); if (o.close) o.close(); return;
      case 'classic': closeEd(); closeMenu(); if (o.fallback) o.fallback(); return;
      case 'in': setZoom(stepZ(cur.z, 1)); return;
      case 'out': setZoom(stepZ(cur.z, -1)); return;
      case 'menu': openMenu(); return;
      case 'tip': { var s = store(); try { if (s) s.setItem(TIP_KEY, 'off'); } catch (x) { /* this visit only */ } var tip = cur.el.querySelector('.sp-tip'); if (tip) tip.parentNode.removeChild(tip); setZoom(cur.z); return; }
      case 'close': closeEd(); return;
      case 'harmdone': harmDone(); return;
    }
  }
  function onKey(e) {
    if (!cur) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      var m = cur.el.querySelector('.sp-menu');
      if (cur.ed) { e.stopPropagation(); closeEd(); return; }
      if (m && !m.hidden) { e.stopPropagation(); closeMenu(); }
      return;
    }
    var t = e.target, cls = t && t.getAttribute ? str(t.getAttribute('class')) : '';
    if ((e.key === 'Enter' || e.key === ' ') && cls === 'sp-hit') { e.preventDefault(); openEd(t.getAttribute('data-region'), t); return; }
    if (e.key === 'Enter' && t && t.getAttribute && t.getAttribute('data-sp-h') != null) { e.preventDefault(); harmDone(); }
  }
  /* a typed change (data-path, data-change) in an editor: tracker.js writes it; the page records it for Undo */
  function onFocusIn(e) { var t = e.target; if (cur && t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && (t.getAttribute('data-path') || t.getAttribute('data-change'))) cur.field = snap(); }
  function onChange(e) {
    var t = e.target; if (!cur || !t || !t.getAttribute || !(t.getAttribute('data-path') || t.getAttribute('data-change'))) return;
    var before = cur.field, label = str(t.getAttribute('data-sp-l') || 'Sheet') + ' changed';
    W.setTimeout(function () { if (!cur) return; var now = snap(); if (before && now && before !== now && cur.opts.record) cur.opts.record(label, before); cur.field = now; }, 0);
  }
  function wire(el) {
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('change', onChange);
    wireZoom(el.querySelector('.sp-view'));
  }

  /* ---------- the seam ---------- */
  function open(container, character, opts) {
    if (!container || !character || !W || !W.document) return false;
    var id = pbIdOf(character); if (!id) return false;
    var c = cache[id]; if (c && c.status === 'missing') return false;
    mount(container, character, opts, id);
    var mine = cur;
    load(id).then(function (entry) { if (cur === mine) ready(entry); }, function () {
      if (cur !== mine) return;
      cur = null; container.innerHTML = '';
      if (mine.opts && typeof mine.opts.fallback === 'function') mine.opts.fallback();
    });
    return true;
  }
  function update(character) {
    if (!cur) return;
    if (character) cur.ch = character;
    if (cur.box && !cur.box.isConnected && cur.root) {
      /* the glance's node was drawn afresh: move into its new page box */
      var nb = cur.root.querySelector('.gl-page');
      if (nb && nb !== cur.box) { cur.box = nb; nb.innerHTML = ''; nb.appendChild(cur.el); }
    }
    redraw();
  }

  return {
    open: open, update: update,
    state: function () { return cur ? { id: cur.id, z: cur.z, ready: !!cur.entry, editor: cur.ed ? cur.ed.region : null, wide: cur.wide } : null; },
    Pure: { validate: validate, shapeOk: shapeOk, expect: expect, pairItems: pairItems, itemProblem: itemProblem, waivedRegions: waivedRegions, guards: guards, marks: marks,
      hits: hits, regionRects: regionRects, editor: editor, clampZ: clampZ, stepZ: stepZ, dblZ: dblZ, keepPoint: keepPoint, loadOf: loadOf,
      NOTE: NOTE, FAMILY: FAMILY, ZSTEPS: ZSTEPS, ZMIN: ZMIN, ZMAX: ZMAX, ZDBL: ZDBL, BASE: BASE, REGIONS: REGIONS },
    _reset: function () { cache = {}; cur = null; }
  };
});
