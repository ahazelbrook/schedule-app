/* gm/lair.js — the lair that grows (suite ticket 5.4, switch between.lair): the GM's side. Plain script, UMD: window.B68GmLair in the browser, module.exports under Node.

   WHAT IT DOES. Menu then The lair: the crew's base as a cut-away section (map kit 1.0's section, drawn by display/lair-draw.js). Each base upgrade, cohort and piece of
   flair on the crew sheet adds a layer; "Put it on the iPad" sends the show kind `lair` for up to three minutes (the server's overlay cap). Flair is not a field of the
   crew sheet, so the GM types it here, and may hold any layer back from the iPad. The pure rules (which layer adds which room) are in display/lair.js, shared with the iPad.

   PERSISTENCE. One GM-scope row of the docs store (kind `lair`, owner `_`): { v: 1, name, front, flair: [text], hide: [layer] }. The layers themselves are never stored: they are
   read from the crew sheet every time, so the base grows as the sheet does.

   PURE API (also for Node tests)
     cleanState(raw) -> { v, name, front, flair, hide }
     view(crew, st) -> { all: [{ layer, kind, text, hidden }], payload, placed }     all: every layer the sheet and the flair list make, with whether it is held back
     addFlair(st, text) -> st    removeFlair(st, text) -> st    toggleHide(st, layer) -> st
   create(host) -> controller. host: { enabled(), crew() -> the crew sheet document, docs: { list(kind), put(row) }, show(kind, payload, opts), night(), now(), kit() }
     refresh() -> Promise  state() view() -> as above  addFlair(text) removeFlair(text) toggleHide(layer) setName(text) setFront('canal'|'street'|'') show() preview() -> { svg, caption, warnings }
   sync(root) takes down a stale Menu entry (N2: there is no Menu line any more); open(root) opens the panel (a Workshop sheet, or inline once the shell binds it). */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmLair = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SWITCH = 'between.lair', KIND = 'lair', OWNER = '_', MS = 180000, MAX_FLAIR = 12;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function clip(v, n) { var s = str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).trim() : s; }
  function lib(name, path) { if (W && W[name]) return W[name]; try { return require(path); } catch (e) { return null; } }
  function LAIR() { return lib('B68Lair', '../display/lair.js'); }

  function cleanState(raw) {
    var r = isObj(raw) ? raw : {}, flair = [], seen = {};
    (Array.isArray(r.flair) ? r.flair : []).forEach(function (x) { var t = clip(x, 56); if (t && !seen[t.toLowerCase()] && flair.length < MAX_FLAIR) { seen[t.toLowerCase()] = 1; flair.push(t); } });
    return { v: 1, name: clip(r.name, 60), front: r.front === 'canal' || r.front === 'street' ? r.front : '', flair: flair, hide: (Array.isArray(r.hide) ? r.hide : []).map(function (x) { return clip(x, 60); }).filter(Boolean).slice(0, 40) };
  }
  function kindOf(layer) { var k = layer.slice(0, 3); return k === 'up:' ? 'upgrade' : k === 'co:' ? 'cohort' : 'flair'; }
  function view(crew, st) {
    var L = LAIR(), s = cleanState(st); if (!L) return { all: [], payload: null, placed: { rooms: [], notes: [], held: [] } };
    var all = L.layersOf(crew, { flair: s.flair, hide: [] }).map(function (l) { return { layer: l, kind: kindOf(l), text: l.slice(3), hidden: s.hide.indexOf(l) >= 0 }; });
    var payload = L.payloadOf(crew, { name: s.name, front: s.front, flair: s.flair, hide: s.hide });
    return { all: all, payload: payload, placed: L.placed(payload) };
  }
  function addFlair(st, text) { var s = cleanState(st), t = clip(text, 56); if (t) s.flair = cleanState({ flair: s.flair.concat([t]) }).flair; return s; }
  function removeFlair(st, text) { var s = cleanState(st); s.flair = s.flair.filter(function (x) { return x !== text; }); s.hide = s.hide.filter(function (x) { return x !== 'fl:' + text; }); return s; }
  function toggleHide(st, layer) { var s = cleanState(st), i = s.hide.indexOf(layer); if (i >= 0) s.hide.splice(i, 1); else s.hide.push(layer); return s; }

  function create(host) {
    host = host || {};
    var st = cleanState(null);
    function enabled() { return typeof host.enabled === 'function' && host.enabled() === true; }
    function crew() { return typeof host.crew === 'function' ? host.crew() : {}; }
    function save() { return host.docs.put({ kind: KIND, owner: OWNER, scope: 'gm', json: st }); }
    function change(next) { st = next; return save(); }
    function night(t) { var n = typeof host.night === 'function' ? host.night() : null; if (n && typeof n.stamp === 'function') n.stamp(t); }
    return {
      enabled: enabled, state: function () { return st; }, view: function () { return view(crew(), st); },
      refresh: function () {
        if (!enabled()) return Promise.resolve(st);
        return Promise.resolve(host.docs.list(KIND)).then(function (rows) {
          var row = (rows || []).filter(function (r) { return isObj(r) && r.owner === OWNER; })[0];
          st = cleanState(row ? row.json : null); return st;
        });
      },
      addFlair: function (t) { return change(addFlair(st, t)); },
      removeFlair: function (t) { return change(removeFlair(st, t)); },
      toggleHide: function (l) { return change(toggleHide(st, l)); },
      setName: function (t) { var n = cleanState(st); n.name = clip(t, 60); return change(n); },
      setFront: function (f) { var n = cleanState(st); n.front = f === 'canal' || f === 'street' ? f : ''; return change(n); },
      preview: function () {
        var D = lib('B68LairDraw', '../display/lair-draw.js'), P = lib('B68CastPhoto', '../display/castphoto.js'), v = view(crew(), st), kit = typeof host.kit === 'function' ? host.kit() : null;
        if (!D || !P || !kit || !v.payload) return { svg: '', caption: [], warnings: [] };
        var d = D.draw(v.payload, kit); if (!d) return { svg: '', caption: [], warnings: [] };
        return { svg: P.scrub(d.svg), caption: d.caption, warnings: d.warnings };
      },
      show: function () {
        var v = view(crew(), st);
        if (!v.payload) return Promise.resolve(false);
        night('The lair up (' + v.payload.layers.length + ' layers)');
        return Promise.resolve(host.show('lair', v.payload, { ms: MS, key: 'lair:' + (typeof host.now === 'function' ? host.now() : Date.now()) })).then(function (r) { return r !== null && r !== undefined; });
      }
    };
  }

  /* ---------- the page (browser only) ---------- */
  function jfetch(method, path, body) {
    var o = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return W.fetch('/api' + path, o).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
  }
  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function btn(label, fn, cls) { var b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; }   /* the app's button, as every tool's */

  var ctl = null;
  function feed() { var P = W.B68GmPage; return P && typeof P.cast === 'function' ? P.cast() : null; }
  function controller() {
    if (ctl) return ctl;
    ctl = create({
      enabled: function () { var f = feed(); return !!(f && W.B68Features && W.B68Features.valueOf(f.doc, SWITCH)); },
      crew: function () { var f = feed(); return f ? f.crew : {}; },
      night: function () { var f = feed(); return f ? f.night : null; },
      kit: function () { return W.B68Map || null; },
      docs: {
        list: function (kind) { return jfetch('GET', '/docs?kind=' + encodeURIComponent(kind) + '&limit=10').then(function (j) { return Array.isArray(j.docs) ? j.docs : []; }); },
        put: function (row) { return jfetch('PUT', '/docs', row); }
      },
      show: function (kind, payload, o) { var P = W.B68GmPage; return P && typeof P.show === 'function' ? P.show(kind, payload, o) : Promise.resolve(null); },
      now: function () { return Date.now(); }
    });
    return ctl;
  }
  var LABEL = { upgrade: 'Upgrade', cohort: 'Cohort', flair: 'Flair' };
  function paint(box) {
    var c = controller(), v = c.view(), st = c.state();
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el('p', 'gm-dim', 'The base, drawn from the crew sheet: a layer for each base upgrade, cohort and piece of flair. Flair is typed here. Hold a layer back and it stays off the iPad.'));
    var top = el('div', 'seg');
    top.appendChild(btn('Put it on the iPad (three minutes)', function () { c.show(); }, 'primary'));
    ['', 'canal', 'street'].forEach(function (f) { top.appendChild(btn(f ? 'Front: ' + f : 'Front: automatic', function () { c.setFront(f).then(function () { paint(box); }); }, (st.front === f ? 'primary' : ''))); });
    box.appendChild(top);
    var nm = el('input'); nm.type = 'text'; nm.maxLength = 60; nm.placeholder = 'Name of the base (the crew name by default)'; nm.value = st.name; nm.setAttribute('aria-label', 'Name of the base');
    nm.addEventListener('change', function () { c.setName(nm.value).then(function () { paint(box); }); });
    box.appendChild(nm);
    var list = el('div', 'gm-lair-list');
    v.all.forEach(function (a) {
      var r = el('div', 'gm-lair-row'); r.style.cssText = 'display:flex;gap:8px;align-items:baseline;margin:4px 0;' + (a.hidden ? 'opacity:.5' : '');
      r.appendChild(el('span', 'gm-dim', LABEL[a.kind])); r.appendChild(el('b', '', a.text));
      r.appendChild(btn(a.hidden ? 'Show' : 'Hold back', function () { c.toggleHide(a.layer).then(function () { paint(box); }); }));
      if (a.kind === 'flair' && st.flair.indexOf(a.text) >= 0) r.appendChild(btn('Remove', function () { c.removeFlair(a.text).then(function () { paint(box); }); }));
      list.appendChild(r);
    });
    if (!v.all.length) list.appendChild(el('p', 'gm-dim', 'Nothing on the crew sheet yet: the Common room stands alone.'));
    box.appendChild(list);
    var add = el('div', 'seg'), fi = el('input'); fi.type = 'text'; fi.maxLength = 56; fi.placeholder = 'A piece of flair'; fi.setAttribute('aria-label', 'A piece of flair');
    add.appendChild(fi); add.appendChild(btn('Add flair', function () { if (fi.value.trim()) c.addFlair(fi.value).then(function () { paint(box); }); }));
    box.appendChild(add);
    var pv = c.preview();
    pv.caption.forEach(function (t) { box.appendChild(el('p', 'gm-dim', t)); });
    if (pv.svg) { var holder = el('div', 'gm-lair-preview'); holder.style.cssText = 'margin-top:10px;max-width:100%;overflow:auto'; holder.innerHTML = pv.svg; box.appendChild(holder); }
  }
  /* N2: the Menu line is gone (the shell places this tool, B68GmTools.get('lair').open()); sync() only takes down a line an older page drew, and says false. */
  function sync(rootEl) {
    var cur = rootEl && typeof rootEl.querySelector === 'function' ? rootEl.querySelector('#gm-menu-lair') : null;
    if (cur && cur.parentNode) cur.parentNode.removeChild(cur);
    return false;
  }
  function open(rootEl) {
    var Wk = W.B68GmWorkshop; if (!Wk || typeof Wk.sheet !== 'function') return null;
    var sh = Wk.sheet(rootEl, 'lair', 'The lair'); if (!sh) return null;
    controller().refresh().then(function () { paint(sh.body); }, function (e) { sh.body.appendChild(el('p', 'gm-warn', 'Could not read the lair: ' + (e && e.message || 'try again'))); });
    sh.open(); return sh;
  }

  return { SWITCH: SWITCH, KIND: KIND, cleanState: cleanState, view: view, addFlair: addFlair, removeFlair: removeFlair, toggleHide: toggleHide, create: create, sync: sync, open: open };
});
