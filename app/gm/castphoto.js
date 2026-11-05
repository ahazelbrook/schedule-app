/* gm/castphoto.js — the cast photo (suite ticket 3.8, switch face.castphoto): the GM's side. Plain script, UMD: window.B68GmCastPhoto in the browser, module.exports under Node.

   WHAT IT DOES. Menu then Cast photo: one true-height line-up of an arc's recurring cast. The cast is every NPC tagged `recurring` or `major` (the tag the standees
   already use), or the list the GM chose for the arc. An NPC the crew has met (revealed) is drawn in full with a caption; one they have not is a silhouette at their
   true height, captioned "?". "Put it on the iPad" sends the show kind `castphoto` for up to three minutes (the server's overlay cap); "Print" opens the browser's print
   dialog for an A4 landscape page, for the end of the arc. Both are drawn from the figure kit's own renderer: nothing is generated.

   SECRECY. The roster names hidden NPCs, so it is a GM-scope row of the docs store (kind `castphoto`, owner = the arc's slug, scope gm): { v: 1, title, ids: [npcId] }. What
   reaches the iPad is the payload below: ids of REVEALED NPCs (the server joins them again and drops anyone hidden) and a bare list of heights for the rest. The print page is
   drawn from the same split, so a hidden NPC's name is on neither.

   PURE API (also for Node tests)
     slug(title) -> an owner id      cleanArc(raw) -> { v, title, ids }
     candidates(npcs) -> [{ id, name, tagged, revealed, h }]    every NPC with a name, tagged first, then by name
     chosen(cands, arc) -> [candidate]    the arc's list in its order, or the tagged NPCs when the arc names none
     payload(chosen, title) -> the `castphoto` show payload | null     { npcIds?, sil?, title? }: revealed ids, then silhouette heights
     toggle(arc, cands, id) -> arc       items(chosen) -> [{ name, spec, h }] for the drawing (a hidden NPC has no name and no spec here)
     printHtml(svg, title) -> the A4 landscape page
   create(host) -> controller. host: { enabled(), npcs() -> { id: npcDoc }, docs: { list(kind), put(row) }, show(kind, payload, opts), night(), now(), print(html) -> bool, kit() }
     refresh() -> Promise  arcs() -> [{ slug, arc }]  current() -> { slug, arc, chosen }  pick(slug) newArc(title) setTitle(title) toggle(id) show() print() preview() -> { svg, count }
   sync(root) takes down a stale Menu entry (N2: there is no Menu line any more); open(root) opens the panel (a Workshop sheet, or inline once the shell binds it). */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmCastPhoto = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SWITCH = 'face.castphoto', KIND = 'castphoto', MS = 180000, MAX = 30;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function clip(v, n) { var s = str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).trim() : s; }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lib(name, path) { if (W && W[name]) return W[name]; try { return require(path); } catch (e) { return null; } }
  function photo() { return lib('B68CastPhoto', '../display/castphoto.js'); }

  function slug(title) { var s = str(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); return s || 'arc'; }
  function cleanArc(raw) {
    var r = isObj(raw) ? raw : {}, seen = {}, ids = [];
    (Array.isArray(r.ids) ? r.ids : []).forEach(function (x) { var id = str(x); if (/^[A-Za-z0-9_-]{1,80}$/.test(id) && !seen[id] && ids.length < MAX) { seen[id] = 1; ids.push(id); } });
    return { v: 1, title: clip(r.title, 60), ids: ids };
  }
  function isTagged(d) { return (Array.isArray(d.tags) ? d.tags : []).some(function (t) { var s = str(t).trim().toLowerCase(); return s === 'recurring' || s === 'major'; }); }
  function candidates(npcs) {
    var P = photo(), out = [];
    Object.keys(isObj(npcs) ? npcs : {}).forEach(function (id) {
      var d = npcs[id];
      if (!isObj(d) || !str(d.name).trim()) return;
      out.push({ id: id, name: clip(d.name, 40), tagged: isTagged(d), revealed: d.revealed === true, spec: isObj(d.spec) ? d.spec : null, h: P ? P.fit(isObj(d.spec) ? d.spec : null) : 68 });
    });
    out.sort(function (a, b) { return (a.tagged === b.tagged ? 0 : a.tagged ? -1 : 1) || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0); });
    return out;
  }
  function chosen(cands, arc) {
    var a = cleanArc(arc), by = {};
    cands.forEach(function (c) { by[c.id] = c; });
    if (a.ids.length) return a.ids.map(function (id) { return by[id]; }).filter(Boolean);
    return cands.filter(function (c) { return c.tagged; }).slice(0, MAX);
  }
  /* the show payload: the met by id (the server joins and re-checks them), the unmet as bare heights */
  function payload(sel, title) {
    var met = sel.filter(function (c) { return c.revealed; }), un = sel.filter(function (c) { return !c.revealed; });
    if (!met.length && !un.length) return null;
    var p = {};
    if (met.length) p.npcIds = met.map(function (c) { return c.id; });
    if (un.length) p.sil = un.map(function (c) { return String(c.h); });
    var t = clip(title, 60); if (t) p.title = t;
    return p;
  }
  function toggle(arc, cands, id) {
    var a = cleanArc(arc), cur = a.ids.length ? a.ids.slice() : chosen(cands, a).map(function (c) { return c.id; }), i = cur.indexOf(id);
    if (i >= 0) cur.splice(i, 1); else if (cur.length < MAX) cur.push(id);
    a.ids = cur;
    return a;
  }
  function items(sel) {
    var P = photo(); if (!P) return [];
    var met = sel.filter(function (c) { return c.revealed; }).map(function (c) { return { name: c.name, spec: c.spec, h: c.h }; });
    var un = sel.filter(function (c) { return !c.revealed; }).map(function (c) { return { name: '', spec: null, h: c.h }; });
    return met.concat(un);
  }
  function printHtml(svg, title) {
    return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>' + esc('Cast photo: ' + str(title)) + '</title><style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}' +
      'body{width:297mm;height:210mm;display:flex;align-items:center;justify-content:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}svg{width:285mm;height:auto;max-height:198mm}</style></head><body>' + svg + '</body></html>';
  }

  function create(host) {
    host = host || {};
    var arcs = [], curSlug = '';
    function enabled() { return typeof host.enabled === 'function' && host.enabled() === true; }
    function cands() { return candidates(typeof host.npcs === 'function' ? host.npcs() : {}); }
    function find(s) { for (var i = 0; i < arcs.length; i++) if (arcs[i].slug === s) return arcs[i]; return null; }
    function current() {
      var a = find(curSlug) || arcs[0] || { slug: slug(''), arc: cleanArc(null) };
      return { slug: a.slug, arc: a.arc, chosen: chosen(cands(), a.arc) };
    }
    function save(slg, arc) { return host.docs.put({ kind: KIND, owner: slg, scope: 'gm', json: arc }); }
    function put(slg, arc) { var a = find(slg); if (a) a.arc = arc; else arcs.push({ slug: slg, arc: arc }); curSlug = slg; return save(slg, arc); }
    function refresh() {
      if (!enabled()) { arcs = []; return Promise.resolve(); }
      return Promise.resolve(host.docs.list(KIND)).then(function (rows) {
        arcs = (rows || []).filter(function (r) { return isObj(r) && typeof r.owner === 'string'; }).map(function (r) { return { slug: r.owner, arc: cleanArc(r.json) }; });
        if (!find(curSlug)) curSlug = arcs.length ? arcs[0].slug : '';
      });
    }
    function night(t) { var n = typeof host.night === 'function' ? host.night() : null; if (n && typeof n.stamp === 'function') n.stamp(t); }
    function preview() {
      var P = photo(), c = current(), list = items(c.chosen), kit = typeof host.kit === 'function' ? host.kit() : null;
      if (!P || !list.length || !kit) return { svg: '', count: list.length };
      var d = P.compose(list, { kit: kit, height: 420, suffix: '-gm', title: c.arc.title });
      return { svg: P.scrub(d.svg), count: d.count };
    }
    return {
      refresh: refresh, enabled: enabled, arcs: function () { return arcs.slice(); }, current: current, preview: preview, candidates: cands,
      pick: function (s) { if (find(s)) curSlug = s; },
      newArc: function (title) { var t = clip(title, 60) || 'New arc', s = slug(t), n = 2, base = s; while (find(s)) s = base + '-' + n++; return put(s, cleanArc({ title: t, ids: [] })); },
      setTitle: function (title) { var c = current(); return put(c.slug, Object.assign(cleanArc(c.arc), { title: clip(title, 60) })); },
      toggle: function (id) { var c = current(); return put(c.slug, toggle(c.arc, cands(), id)); },
      show: function () {
        var c = current(), p = payload(c.chosen, c.arc.title);
        if (!p) return Promise.resolve(false);
        night('Cast photo up' + (c.arc.title ? ': ' + c.arc.title : ''));
        return Promise.resolve(host.show('castphoto', p, { ms: MS, key: 'castphoto:' + (typeof host.now === 'function' ? host.now() : Date.now()) })).then(function (r) { return r !== null && r !== undefined; });
      },
      print: function () {
        var p = preview(); if (!p.svg || typeof host.print !== 'function') return false;
        return host.print(printHtml(p.svg, current().arc.title)) !== false;
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
  function printFrame(html) {
    var d = W && W.document; if (!d || !d.body) return false;
    var f = d.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    d.body.appendChild(f);
    var fd = f.contentDocument || (f.contentWindow && f.contentWindow.document); if (!fd) { d.body.removeChild(f); return false; }
    fd.open(); fd.write(html); fd.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* the dialog is the browser's */ } setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 60000); }, 400);
    return true;
  }

  var ctl = null;
  function feed() { var P = W.B68GmPage; return P && typeof P.cast === 'function' ? P.cast() : null; }
  function controller() {
    if (ctl) return ctl;
    ctl = create({
      enabled: function () { var f = feed(); return !!(f && W.B68Features && W.B68Features.valueOf(f.doc, SWITCH)); },
      npcs: function () { var f = feed(); return f ? f.npcs : {}; },
      night: function () { var f = feed(); return f ? f.night : null; },
      kit: function () { return W.B68Figure || null; },
      docs: {
        list: function (kind) { return jfetch('GET', '/docs?kind=' + encodeURIComponent(kind) + '&limit=50').then(function (j) { return Array.isArray(j.docs) ? j.docs : []; }); },
        put: function (row) { return jfetch('PUT', '/docs', row); }
      },
      show: function (kind, payload, o) { var P = W.B68GmPage; return P && typeof P.show === 'function' ? P.show(kind, payload, o) : Promise.resolve(null); },
      print: printFrame, now: function () { return Date.now(); }
    });
    return ctl;
  }
  function paint(box) {
    var c = controller(), cur = c.current();
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el('p', 'gm-dim', 'One line-up of the recurring cast (tagged recurring or major, or the list you choose for the arc). The ones the crew has met are drawn; the rest are silhouettes at their true height.'));
    var arcRow = el('div', 'seg');
    c.arcs().forEach(function (a) { arcRow.appendChild(btn(a.arc.title || a.slug, function () { c.pick(a.slug); paint(box); }, a.slug === cur.slug ? 'primary' : '')); });
    arcRow.appendChild(btn('New arc', function () { var t = W.prompt ? W.prompt('Name the arc', '') : ''; if (t) c.newArc(t).then(function () { paint(box); }); }));
    box.appendChild(arcRow);
    var tin = el('input'); tin.type = 'text'; tin.maxLength = 60; tin.placeholder = 'Arc title'; tin.value = cur.arc.title || ''; tin.setAttribute('aria-label', 'Arc title');
    tin.addEventListener('change', function () { c.setTitle(tin.value).then(function () { paint(box); }); });
    box.appendChild(tin);
    var list = el('div', 'gm-cp-list'), on = {};
    cur.chosen.forEach(function (x) { on[x.id] = 1; });
    c.candidates().forEach(function (k) {
      var r = el('label', 'gm-cp-row'); r.style.cssText = 'display:flex;gap:8px;align-items:baseline;margin:4px 0';
      var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!on[k.id]; cb.addEventListener('change', function () { c.toggle(k.id).then(function () { paint(box); }); });
      r.appendChild(cb); r.appendChild(el('b', '', k.name)); r.appendChild(el('span', 'gm-dim', (k.revealed ? 'met' : 'not met: silhouette') + ' · ' + k.h + ' in' + (k.tagged ? ' · tagged' : '')));
      list.appendChild(r);
    });
    if (!list.firstChild) list.appendChild(el('p', 'gm-dim', 'No NPCs yet.'));
    box.appendChild(list);
    var row = el('div', 'seg');
    row.appendChild(btn('Put it on the iPad (three minutes)', function () { c.show().then(function (ok) { if (!ok) box.appendChild(el('p', 'gm-warn', 'Choose at least one person first.')); }); }, 'primary'));
    row.appendChild(btn('Print (A4)', function () { if (!c.print()) box.appendChild(el('p', 'gm-warn', 'Nothing to print yet.')); }));
    box.appendChild(row);
    var pv = c.preview();
    if (pv.svg) { var holder = el('div', 'gm-cp-preview'); holder.style.cssText = 'margin-top:10px;max-width:100%;overflow:auto'; holder.innerHTML = pv.svg; box.appendChild(holder); }
  }
  /* N2: the Menu line is gone (the shell places this tool, B68GmTools.get('castphoto').open()); sync() only takes down a line an older page drew, and says false. */
  function sync(rootEl) {
    var cur = rootEl && typeof rootEl.querySelector === 'function' ? rootEl.querySelector('#gm-menu-castphoto') : null;
    if (cur && cur.parentNode) cur.parentNode.removeChild(cur);
    return false;
  }
  function open(rootEl) {
    var Wk = W.B68GmWorkshop; if (!Wk || typeof Wk.sheet !== 'function') return null;
    var sh = Wk.sheet(rootEl, 'castphoto', 'Cast photo'); if (!sh) return null;
    controller().refresh().then(function () { paint(sh.body); }, function (e) { sh.body.appendChild(el('p', 'gm-warn', 'Could not read the arcs: ' + (e && e.message || 'try again'))); });
    sh.open(); return sh;
  }

  return { SWITCH: SWITCH, KIND: KIND, slug: slug, cleanArc: cleanArc, candidates: candidates, chosen: chosen, payload: payload, toggle: toggle, items: items, printHtml: printHtml, create: create, sync: sync, open: open };
});
