/* Creator core: state, helpers, the control factory, drawing, playbook looks. Sets window.B68. */
(function () {
  'use strict';
  var CT = window.B68Content;
  var A = window.B68 = {};
  if (!CT) { var w = document.getElementById('warnings'); if (w) w.textContent = 'The content did not load.'; return; }
  /* The figure kit is not in the first load (routes.js: the 'figures' bundle arrives after the first paint). K, C, O, CLOTH and
     SKINS are shells that bindKit() fills IN PLACE when the kit and the cast canon are here, so steps.js and boot.js, which
     captured them at load, see the real ones. Nothing here draws or reads the kit until A.kitReady; A.onKit(fn) runs fn then
     (at once when it already is). */
  var K = {}, C = { pcs: [], npcs: [], byId: {} }, O = {}, kitQueue = [];
  A.kitReady = false;
  var $ = function (id) { return document.getElementById(id); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  function merge(a, b) { var o = clone(a); for (var k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object') ? merge(o[k], b[k]) : clone(b[k]); return o; }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function chance(p) { return Math.random() < p; }
  function slug(s) { return String(s || 'subject').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'subject'; }
  function feet(inches) { return Math.floor(inches / 12) + "'" + (inches % 12) + '"'; }
  function newCode(prefix) { return (prefix || 'UNK').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X') + '-968-' + String(1000 + Math.floor(Math.random() * 9000)); }
  function hex(tok) { try { return K.tokens.tok(tok) || '#888'; } catch (e) { return '#888'; } }
  function describe(kind, name) { try { var p = K.registry.get(kind, name); return p && p.describe || ''; } catch (e) { return ''; } }
  function params(kind, name) { try { var p = K.registry.get(kind, name); return p && p.params || {}; } catch (e) { return {}; } }
  function kickerHtml(s) { var LIGHT = { a: 1, an: 1, the: 1, of: 1, and: 1, who: 1, their: 1, in: 1, from: 1, at: 1, to: 1, with: 1, or: 1, by: 1 }; return esc(s).split(' ').map(function (w) { return LIGHT[w.toLowerCase()] ? '<span class="lt">' + w + '</span>' : w; }).join(' '); }

  var CLOTH = [];
  var HAIR_TOKENS = ['cloth-black', 'cloth-graphite', 'cloth-chocolate', 'cloth-brown', 'cloth-tobacco', 'cloth-tan', 'cloth-camel', 'cloth-ochre', 'cloth-mustard', 'cloth-rust', 'cloth-brick', 'cloth-cream', 'cloth-stone', 'cloth-ash', 'ink-300', 'ink-150', 'cloth-white', 'cloth-lilac', 'cloth-magenta', 'cloth-cobalt'];
  var SKINS = [];
  function bindKit() {
    var rk = window.B68Figure, rc = window.B68Cast;
    if (A.kitReady || !rk || !rc) return;
    Object.assign(K, rk); Object.assign(C, rc); Object.assign(O, rk.options());
    O.cloth.forEach(function (t) { CLOTH.push(t); }); Object.keys(K.tokens.SKIN).forEach(function (t) { SKINS.push(t); });
    A.kitReady = true;
    var q = kitQueue; kitQueue = [];
    q.forEach(function (fn) { try { fn(); } catch (e) { if (window.console) console.error(e); } });
  }
  A.bindKit = bindKit;
  A.onKit = function (fn) { if (A.kitReady) fn(); else kitQueue.push(fn); };

  /* ---------- state ---------- */
  var S = A.S = { spec: null, sheet: null, step: 0, view: 'figure', dirty: false };
  function blankSheet() { return { playbook: null, name: '', alias: '', heritage: null, heritageDetail: '', background: null, backgroundDetail: '', alt: [], owning: null, backing: null, cohortName: '', cohortType: null, cohortHousing: null, dots: {}, ability: null, ability2: null, customAbility: '', frame: [], keys: [], deadlockKey: null, deadlockMode: null, contacts: {}, contactCustom: '', vice: null, purveyor: '', items: [], look: '', wearing: '', wearingNote: '', damage: '', helps: '',
    /* round 3 (paranormal playbooks) */ customKey: '', keyLocks: {}, stricture: null, enemies: '', ghostItems: '', feeding: '', telltale: '', echoAbilities: '', mission: null, missionAnswers: ['', '', '', ''] }; }
  var BASE_FIGURE = { id: 'subject', name: '', plate: 'Unknown', code: 'XXX-968-0000', halo: 'slate-500', heightIn: 70, figure: 'masc', shape: 'lean', build: 1, skin: 'olive', age: 34,
    pose: { stance: 'easy', weight: 'R', arms: { R: 'down', L: 'pocket' } }, head: { shape: 'oval' },
    face: { eyes: 'almond', brows: 'straight', nose: 'straight', mouth: 'neutral', expression: 'neutral' },
    hair: { style: 'short', color: 'cloth-chocolate' },
    outfit: { base: { type: 'shirt', color: 'cloth-cream' }, outer: { type: 'suit-jacket', color: 'cloth-sea' }, bottom: { type: 'trousers', color: 'cloth-sea' }, feet: { type: 'oxfords', color: 'cloth-black' } }, props: [] };

  /* the playbook looks: a starting figure per playbook, validated against the kit */
  var LOOKS = A.LOOKS = {
    hound: { pose: { stance: 'easy', weight: 'L', arms: { R: 'smoke', L: 'pocket' }, head: { tilt: -2, yaw: 6 } }, outfit: { base: { type: 'shirt', color: 'cloth-white' }, neck: { type: 'tie', color: 'cloth-black', spot: true }, outer: { type: 'trench', color: 'cloth-stone', collar: 'up' }, bottom: { type: 'trousers', color: 'cloth-charcoal' }, feet: { type: 'oxfords', color: 'cloth-black' } }, props: [{ type: 'cigarette' }], companion: { type: 'dog', breed: 'hound', side: 'L', pose: 'sit' } },
    hull: { skin: 'porcelain', hair: { style: 'bald' }, face: { eyes: 'round', brows: 'straight', nose: 'flat', mouth: 'neutral', expression: 'neutral', eyewear: { type: 'shades' } }, pose: { stance: 'square', arms: { R: 'down', L: 'down' } }, outfit: { base: { type: 'tee', color: 'cloth-black' }, outer: { type: 'shearling', color: 'cloth-ink-blue' }, bottom: { type: 'trousers', color: 'cloth-charcoal' }, feet: { type: 'combat-boots', color: 'cloth-black' } }, props: [], companion: { type: 'cat' } },
    intellectual: { shape: 'lanky', face: { eyes: 'almond', brows: 'straight', nose: 'hooked', mouth: 'thin', expression: 'cool', eyewear: { type: 'round-wire' } }, hair: { style: 'side-part', color: 'cloth-chocolate' }, pose: { stance: 'easy', weight: 'L', arms: { R: 'hold', L: 'pocket' } }, outfit: { base: { type: 'turtleneck', color: 'cloth-cream' }, outer: { type: 'nehru', color: 'cloth-tobacco' }, bottom: { type: 'trousers', color: 'cloth-tobacco' }, feet: { type: 'chelsea-boots', color: 'cloth-chocolate' } }, props: [{ type: 'book' }] },
    operative: { face: { eyes: 'heavy', brows: 'straight', nose: 'straight', mouth: 'thin', expression: 'cool', eyewear: { type: 'shades' } }, hair: { style: 'side-part', color: 'cloth-black' }, pose: { stance: 'easy', weight: 'R', arms: { R: 'pocket', L: 'pocket' } }, outfit: { base: { type: 'turtleneck', color: 'cloth-black' }, outer: { type: 'suit-jacket', color: 'cloth-charcoal' }, bottom: { type: 'trousers', color: 'cloth-charcoal', cut: 'slim' }, feet: { type: 'oxfords', color: 'cloth-black' } }, props: [] },
    paranormalist: { pose: { stance: 'square', arms: { R: 'raise', L: 'raise' }, head: { tilt: 0 } }, face: { eyes: 'round', brows: 'arched', nose: 'straight', mouth: 'neutral', expression: 'surprised' }, hair: { style: 'short', color: 'cloth-chocolate', hat: { type: 'helmet', color: 'cloth-ash' } }, outfit: { base: { type: 'shirt', color: 'cloth-cobalt' }, bottom: { type: 'trousers', color: 'cloth-navy' }, feet: { type: 'oxfords', color: 'cloth-black' } }, props: [] },
    radical: { face: { eyes: 'narrow', brows: 'angled', nose: 'straight', mouth: 'full', expression: 'determined' }, hair: { style: 'afro', color: 'cloth-black', hat: { type: 'beret', color: 'cloth-black' } }, pose: { stance: 'wide', arms: { R: 'cross', L: 'cross' } }, outfit: { base: { type: 'turtleneck', color: 'cloth-black' }, outer: { type: 'leather-jacket', color: 'cloth-chocolate' }, bottom: { type: 'slacks', color: 'cloth-black' }, feet: { type: 'chelsea-boots', color: 'cloth-black' } }, props: [{ type: 'pin-badges' }, { type: 'bandolier' }] },
    swinger: { face: { eyes: 'upturned', brows: 'arched', nose: 'button', mouth: 'wide', expression: 'amused' }, hair: { style: 'mod-mop', color: 'cloth-ochre' }, pose: { stance: 'easy', weight: 'L', arms: { R: 'hold', L: 'hip' }, head: { tilt: 4, yaw: -8 } }, outfit: { base: { type: 'shirt', color: 'cloth-cream' }, neck: { type: 'scarf', color: 'cloth-magenta', spot: true }, outer: { type: 'blazer', color: 'cloth-mustard', open: true }, bottom: { type: 'trousers', color: 'cloth-mustard', cut: 'flare' }, feet: { type: 'loafers', color: 'cloth-oxblood' } }, props: [{ type: 'glass' }] },
    /* paranormal playbooks. The kit has no hooded cloak, robes or foil jumpsuit: the cape-coat stands in for a cloak, the gown for robes, the boiler-suit for a jumpsuit. */
    ghost: { skin: 'pale', shape: 'slim', face: { eyes: 'heavy', brows: 'straight', nose: 'straight', mouth: 'thin', expression: 'sad' }, hair: { style: 'long-straight', color: 'cloth-ash' }, pose: { stance: 'square', arms: { R: 'down', L: 'down' }, head: { tilt: 0, yaw: 0 }, stoop: 0.1 }, outfit: { base: { type: 'shirt', color: 'cloth-white' }, outer: { type: 'cape-coat', color: 'cloth-stone', open: true }, bottom: { type: 'trousers', color: 'cloth-ash' }, feet: { type: 'oxfords', color: 'cloth-stone' } }, props: [] },
    vampire: { skin: 'pale', shape: 'column', face: { eyes: 'heavy', brows: 'arched', nose: 'straight', mouth: 'thin', expression: 'cool', eyewear: { type: 'shades' } }, hair: { style: 'slick-back', color: 'cloth-black' }, pose: { stance: 'easy', weight: 'L', arms: { R: 'down', L: 'pocket' }, head: { tilt: -2, yaw: 4 } }, outfit: { base: { type: 'shirt', color: 'cloth-white' }, neck: { type: 'bow-tie', color: 'cloth-black', spot: true }, outer: { type: 'double-breasted', color: 'cloth-black' }, bottom: { type: 'trousers', color: 'cloth-black' }, feet: { type: 'oxfords', color: 'cloth-black' } }, props: [{ type: 'cane' }] },
    timetraveler: { face: { eyes: 'round', brows: 'straight', nose: 'straight', mouth: 'neutral', expression: 'wary', eyewear: { type: 'aviators', frame: 'metal-chrome' } }, hair: { style: 'crew', color: 'cloth-black', hat: { type: 'helmet', color: 'cloth-white', band: 'cloth-sky' } }, pose: { stance: 'square', arms: { R: 'down', L: 'hold' } }, outfit: { dress: { type: 'boiler-suit', color: 'cloth-ash' }, feet: { type: 'go-go-boots', color: 'cloth-white' } }, props: [] },
    timepast: { face: { eyes: 'narrow', brows: 'heavy', nose: 'hooked', mouth: 'grim', expression: 'stern' }, hair: { style: 'long-straight', color: 'cloth-black' }, pose: { stance: 'easy', weight: 'R', arms: { R: 'down', L: 'hip' }, head: { tilt: 2 } }, outfit: { base: { type: 'tee', color: 'cloth-charcoal' }, outer: { type: 'cape-coat', color: 'cloth-black' }, bottom: { type: 'trousers', color: 'cloth-chocolate' }, feet: { type: 'combat-boots', color: 'cloth-black', tucked: true } }, props: [] },
    veteran: { shape: 'invtri', face: { eyes: 'narrow', brows: 'heavy', nose: 'straight', mouth: 'grim', expression: 'stern', marks: [{ type: 'scar', at: 'cheek-L' }] }, hair: { style: 'afro', color: 'cloth-black' }, pose: { stance: 'easy', weight: 'R', arms: { R: 'down', L: 'hip' } }, outfit: { base: { type: 'tee', color: 'cloth-cream' }, outer: { type: 'field-jacket', color: 'cloth-khaki' }, bottom: { type: 'cargo-trousers', color: 'cloth-khaki' }, feet: { type: 'combat-boots', color: 'cloth-black', tucked: true } }, props: [{ type: 'rifle-back' }, { type: 'pin-badges' }] }
  };
  function lookFor(id) { var s = merge(BASE_FIGURE, LOOKS[id] || {}); var L = LOOKS[id] || {}; ['outfit', 'face', 'hair', 'pose', 'props', 'companion'].forEach(function (k) { if (k in L) s[k] = clone(L[k]); }); s.id = id; return s; }
  A.lookFor = lookFor;
  function applyLook(id) {
    var keep = { name: S.spec.name, plate: S.spec.plate, code: S.spec.code, notes: S.spec.notes };
    var s = lookFor(id); for (var k in keep) if (keep[k]) s[k] = keep[k];
    var pb = CT.byId[id]; if (pb) s.halo = pb.halo;
    S.spec = s; S.dirty = false; changed();
  }
  A.applyLook = applyLook;

  /* ---------- paths ---------- */
  function root(path) { return path.indexOf('sheet.') === 0 ? [S.sheet, path.slice(6)] : [S.spec, path]; }
  function get(path) { var r = root(path), o = r[0], ps = r[1].split('.'); for (var i = 0; i < ps.length; i++) { if (o == null) return undefined; o = o[ps[i]]; } return o; }
  function set(path, value) {
    var r = root(path), o = r[0], ps = r[1].split('.');
    for (var i = 0; i < ps.length - 1; i++) { if (o[ps[i]] == null || typeof o[ps[i]] !== 'object') o[ps[i]] = {}; o = o[ps[i]]; }
    if (value === null || value === undefined) delete o[ps[ps.length - 1]]; else o[ps[ps.length - 1]] = value;
    if (r[0] === S.spec) S.dirty = true;
    changed();
  }
  A.get = get; A.set = set;

  /* ---------- drawing ---------- */
  var drawTimer = null, lineTimer = null, last = null, drawKey = null;
  function changed() { if (drawTimer) clearTimeout(drawTimer); var ae = document.activeElement, typing = ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type === 'text')); drawTimer = setTimeout(draw, typing ? 350 : 40); if (lineTimer) clearTimeout(lineTimer); lineTimer = setTimeout(function () { lineTimer = null; if (window.requestIdleCallback) window.requestIdleCallback(function () { A.drawLineup(); }, { timeout: 1500 }); else A.drawLineup(); }, 900); syncAll(); if (A.onChange) A.onChange(); }
  A.changed = changed;
  function pbOf() { return S.sheet && S.sheet.playbook ? CT.byId[S.sheet.playbook] : null; }
  A.pbOf = pbOf;
  function renderSpec() { var s = clone(S.spec); s.id = slug(s.id || s.name); if (S.sheet.name) s.name = S.sheet.name; return s; }
  A.renderSpec = renderSpec;
  function draw() {
    drawTimer = null;
    if (!A.kitReady) return;   /* nothing to draw with yet: boot.js draws when the kit arrives (creator mode only) */
    var s = renderSpec(), pb = pbOf();
    try {
      var lod = (window.B68Zoom && window.B68Zoom.state.scale >= 2) ? 'hi' : undefined;
      /* most of the creator edits the sheet (name, dots, abilities, contacts), which never changes the figure: when the spec,
         view and detail level match the last draw, keep the SVG on screen (re-parsing a 270 KB SVG is the slow part on a phone) */
      var key = S.view + '|' + (lod || '') + '|' + JSON.stringify(s);
      if (key !== drawKey) {
      drawKey = null;
      if (S.view === 'figure') { last = K.lineup([s], { chart: true, height: 560, lod: lod }); $('frame').classList.remove('mug'); $('plate').hidden = false; }
      else { last = K.portrait(s); $('frame').classList.add('mug'); $('plate').hidden = true; }
      $('art').innerHTML = last.svg;
      var svg = $('art').querySelector('svg'); if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
      var w = last.warnings || [];
      $('warnings').textContent = w.length ? w.join('\n') : 'Nothing to report. The spec is clean.';
      $('warnings').className = 'body' + (w.length ? ' warn' : '');
      $('lodNote').textContent = 'drawn live · ' + (last.lod || lod || 'mid') + ' detail';
      A.lastWarnings = w;
      drawKey = key; }
    } catch (e) { drawKey = null; $('warnings').textContent = 'The kit could not draw this spec: ' + e.message; $('warnings').className = 'body warn'; A.lastWarnings = [e.message]; }
    $('plateName').textContent = S.spec.plate || S.sheet.name || 'Unknown';
    $('plateCode').textContent = S.spec.code || 'XXX-968-0000';
    $('htBadge').textContent = feet(S.spec.heightIn || 70) + ' · ' + (S.spec.heightIn || 70) + ' in';
    $('partCount').textContent = countParts(S.spec) + ' parts';
    var cover = $('cover');
    $('art').classList.toggle('ghostly', !!(pb && pb.ghost));
    if (pb) { cover.style.setProperty('--duo-a', pb.duo ? pb.duo[0] : '#f2ede1'); cover.style.setProperty('--duo-b', pb.duo ? pb.duo[1] : '#14110e'); $('coverWord').textContent = pb.name; $('coverMeta').innerHTML = (pb.subtitle ? '<span class="lt">' + esc(pb.subtitle) + '</span><br>' : '') + '<span class="lt">' + esc(pb.section || 'Core playbook') + '</span><br>' + esc(pb.ordinal) + ' <span class="lt">of</span> ' + (pb.paranormal ? 'FOUR' : 'EIGHT'); }
    else { cover.style.removeProperty('--duo-a'); cover.style.removeProperty('--duo-b'); $('coverWord').textContent = 'Subject'; $('coverMeta').innerHTML = '<span class="lt">Core playbook</span><br>not yet chosen'; }
    if (A.snapshot) A.snapshot();
  }
  A.draw = draw;
  function countParts(s) {
    var n = 1; if (s.hair && s.hair.style) n++; if (s.hair && s.hair.hat) n++;
    var o = s.outfit || {}; Object.keys(o).forEach(function (k) { if (o[k] && o[k].type) n++; });
    n += (s.props || []).length; if (s.companion) n++; if (s.face && s.face.facialHair) n++; if (s.face && s.face.eyewear) n++; if (s.face && s.face.makeup) n++; n += ((s.face && s.face.marks) || []).length; return n;
  }
  A.mugshot = function () { if (!A.kitReady) throw new Error('The figure kit is still loading.'); return K.portrait(renderSpec()); };
  A.figureSvg = function (h) { if (!A.kitReady) throw new Error('The figure kit is still loading.'); return K.render(renderSpec(), { height: h || 900 }).svg; };

  /* ---------- control factory ---------- */
  var controls = A.controls = [];
  function field(label, hint) { var f = el('div', 'field'); var l = el('div', 'label'); l.innerHTML = '<span>' + esc(label) + '</span><span class="val"></span>'; f.appendChild(l); if (hint) f.appendChild(el('div', 'hint', esc(hint))); return f; }
  function chips(label, path, options, o) {
    o = o || {}; var f = field(label, o.hint); var row = el('div', 'row'); f.appendChild(row);
    if (o.none) { var nb = el('button', 'chip none', esc(o.none)); nb.type = 'button'; nb.dataset.v = ''; nb.onclick = function () { set(path, null); if (o.after) o.after(null); }; row.appendChild(nb); }
    options.forEach(function (name) {
      var b = el('button', 'chip' + (o.text ? ' txt' : ''), esc(o.labels && o.labels[name] || (o.text ? name : name.replace(/-/g, ' ')))); b.type = 'button'; b.dataset.v = name;
      if (o.kind) b.title = describe(o.kind, name); else if (o.titles && o.titles[name]) b.title = o.titles[name];
      b.onclick = function () { set(path, name); if (o.after) o.after(name); }; row.appendChild(b);
    });
    controls.push({ el: f, sync: function () { var v = get(path); row.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === (v == null ? '' : String(v)))); }); }, visible: o.visible });
    return f;
  }
  function multi(label, path, options, o) {
    o = o || {}; var f = field(label, o.hint); var row = el('div', 'row'); f.appendChild(row);
    options.forEach(function (name) { var b = el('button', 'chip txt', esc(name)); b.type = 'button'; b.dataset.v = name; b.onclick = function () { var cur = (get(path) || []).slice(); var i = cur.indexOf(name); if (i >= 0) cur.splice(i, 1); else { if (o.max && cur.length >= o.max) return; cur.push(name); } set(path, cur); }; row.appendChild(b); });
    controls.push({ el: f, sync: function () { var v = get(path) || []; row.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(v.indexOf(b.dataset.v) >= 0)); }); f.querySelector('.val').textContent = o.max ? v.length + ' / ' + o.max : (v.length ? v.length + ' chosen' : ''); }, visible: o.visible });
    return f;
  }
  function swatches(label, path, tokens, o) {
    o = o || {}; var f = field(label, o.hint); var row = el('div', 'swatches'); f.appendChild(row);
    if (o.none) { var nb = el('button', 'chip none sm', esc(o.none)); nb.type = 'button'; nb.dataset.v = ''; nb.onclick = function () { set(path, null); }; row.appendChild(nb); }
    tokens.forEach(function (t) { var b = el('button', 'sw'); b.type = 'button'; b.dataset.v = t; b.style.setProperty('--c', hex(t)); b.title = t; b.setAttribute('aria-label', t); b.onclick = function () { set(path, t); }; row.appendChild(b); });
    controls.push({ el: f, sync: function () { var v = get(path); f.querySelector('.val').textContent = v || (o.none ? o.none.toLowerCase() : ''); row.querySelectorAll('[data-v]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === (v == null ? '' : v))); }); }, visible: o.visible });
    return f;
  }
  function range(label, path, min, max, step, o) {
    o = o || {}; var f = field(label, o.hint); var inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.id = 'r-' + path.replace(/\./g, '-'); f.appendChild(inp);
    var fmt = o.fmt || function (v) { return String(v); };
    inp.oninput = function () { var v = parseFloat(inp.value); if (o.clearAt != null && Math.abs(v - o.clearAt) < 1e-9) set(path, null); else set(path, v); };
    controls.push({ el: f, sync: function () { var v = get(path); if (v == null) v = o.def != null ? o.def : (o.clearAt != null ? o.clearAt : min); if (document.activeElement !== inp) inp.value = v; f.querySelector('.val').textContent = fmt(parseFloat(inp.value)); }, visible: o.visible });
    return f;
  }
  function text(label, path, o) {
    o = o || {}; var f = field(label, o.hint); var inp = document.createElement(o.multi ? 'textarea' : 'input'); if (!o.multi) inp.type = 'text'; if (o.mono) inp.className = 'mono'; inp.id = 't-' + path.replace(/\./g, '-'); inp.placeholder = o.placeholder || ''; f.appendChild(inp);
    inp.oninput = function () { set(path, inp.value === '' ? null : inp.value); if (o.after) o.after(inp.value); };
    if (o.button) { var b = el('button', 'btn sm', esc(o.button)); b.type = 'button'; b.style.justifySelf = 'start'; b.onclick = function () { o.onButton(); }; f.appendChild(b); }
    controls.push({ el: f, sync: function () { var v = get(path); if (document.activeElement !== inp) inp.value = v == null ? '' : v; }, visible: o.visible });
    return f;
  }
  function toggle(label, path, o) {
    o = o || {}; var f = field(label, o.hint); var seg = el('div', 'seg'); f.appendChild(seg);
    var offB = el('button', 'chip', esc(o.off || 'No')); offB.type = 'button'; offB.onclick = function () { set(path, o.offValue === undefined ? null : o.offValue); };
    var onB = el('button', 'chip', esc(o.on || 'Yes')); onB.type = 'button'; onB.onclick = function () { set(path, o.onValue === undefined ? true : o.onValue); };
    seg.appendChild(offB); seg.appendChild(onB);
    controls.push({ el: f, sync: function () { var v = get(path); var on = o.onValue === undefined ? !!v : v === o.onValue; onB.setAttribute('aria-pressed', String(on)); offB.setAttribute('aria-pressed', String(!on)); }, visible: o.visible });
    return f;
  }
  function group(children, visible) { var g = el('div', 'sub'); children.forEach(function (c) { g.appendChild(c); }); controls.push({ el: g, sync: function () {}, visible: visible }); return g; }
  function custom(node, sync, visible) { controls.push({ el: node, sync: sync || function () {}, visible: visible }); return node; }
  function slot(label, key, what) {
    var kind = K.SLOT_KIND[key], names = O[kind] || [];
    var box = el('div', 'slot'); box.innerHTML = '<div class="label"><span>' + esc(label) + '</span><span class="what">' + esc(what) + '</span></div>';
    var p = 'outfit.' + key;
    box.appendChild(chips('', p + '.type', names, { kind: kind, none: 'None', after: function (name) { if (name && !get(p + '.color')) set(p + '.color', key === 'feet' ? 'cloth-black' : 'cloth-charcoal'); if (!name) set(p, null); } }));
    var has = function () { return !!get(p + '.type'); };
    var ps = function () { return params(kind, get(p + '.type')); };
    box.appendChild(group([
      swatches('Colour', p + '.color', CLOTH),
      chips('Pattern', p + '.pattern.type', O.textile, { kind: 'textile', none: 'Plain', after: function (n) { if (!n) set(p + '.pattern', null); }, visible: function () { return has() && 'pattern' in ps(); } }),
      swatches('Pattern ink', p + '.pattern.color2', CLOTH, { none: 'Auto', visible: function () { return has() && !!get(p + '.pattern.type'); } }),
      chips('Cut', p + '.cut', ['slim', 'straight', 'tapered', 'wide', 'flare', 'bootcut'], { none: 'Default', visible: function () { return has() && 'cut' in ps(); } }),
      toggle('Worn open', p + '.open', { visible: function () { return has() && 'open' in ps(); } }),
      toggle('Collar up', p + '.collar', { onValue: 'up', offValue: null, visible: function () { return has() && 'collar' in ps(); } }),
      toggle('Tucked', p + '.tucked', { visible: function () { return has() && 'tucked' in ps(); } }),
      toggle('Turn-ups', p + '.cuff', { visible: function () { return has() && 'cuff' in ps(); } }),
      chips('Sleeves', p + '.sleeves', ['none', 'short', 'elbow', 'long'], { none: 'Default', visible: function () { return has() && 'sleeves' in ps(); } }),
      swatches('Colour block', p + '.block.color', CLOTH, { none: 'None', visible: function () { return has() && 'block' in ps(); } }),
      toggle('Keep colour in plate schemes', p + '.spot', { visible: has })
    ], has));
    return box;
  }
  function syncAll() {
    controls.forEach(function (c) { var vis = c.visible ? !!c.visible() : true; c.el.hidden = !vis; if (vis) c.sync(); });
    controls.forEach(function (c) { if (c.el.classList.contains('field') && !c.el.querySelector('.row, .swatches, input, textarea, select, .seg')) c.el.hidden = true; });
  }
  A.syncAll = syncAll;
  var toastT = null;
  /* one region outside the page (#toast): news in a status line, errors in an alert line, so both are announced */
  function toast(msg, bad) {
    var ok = $('toastMsg'), er = $('toastErr'); if (!ok || !er) return;
    (bad ? ok : er).textContent = ''; (bad ? er : ok).textContent = String(msg == null ? '' : msg);
    if (toastT) clearTimeout(toastT); toastT = setTimeout(function () { ok.textContent = ''; er.textContent = ''; }, bad ? 6000 : 3600);
  }

  Object.assign(A, { K: K, C: C, CT: CT, O: O, $: $, el: el, esc: esc, clone: clone, merge: merge, pick: pick, chance: chance, slug: slug, feet: feet, newCode: newCode, hex: hex, describe: describe, params: params, kickerHtml: kickerHtml,
    CLOTH: CLOTH, HAIR_TOKENS: HAIR_TOKENS, SKINS: SKINS, BASE_FIGURE: BASE_FIGURE, blankSheet: blankSheet,
    field: field, chips: chips, multi: multi, swatches: swatches, range: range, text: text, toggle: toggle, group: group, custom: custom, slot: slot, toast: toast });
  bindKit();   /* the kit is already here (the file:// checks, the artifact); else routes.js calls A.bindKit when it arrives */
})();
