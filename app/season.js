/* season.js — the season print (docs/history/DEPLOY.md phase 4, CAMPAIGN.md "Season print"): one printable document of the whole
   campaign, reached from #print or B68Season.open(). boot.js owns the mode (body[data-mode="print"]) and the route,
   and hands render() an api; this module only reads (the characters collection and campaign/main, once) and never
   writes.

   Pages, each starting on a new printed page: the cover (crew, season, date printed, the line-up at true height), the
   crew (the crew sheet as the table page draws it, the shared clocks, the campaign log) and one page per filed
   character (the living sheet, read-only, as its own Print lays it out). The crew and the sheets are drawn by their own
   modules (B68Campaign.crewSheet.render, B68Tracker.renderStatic) into shadow roots that carry the page's stylesheets,
   so the existing #table-page / #dossier rules style the copies unchanged and their ids never collide with the live
   sheet's. On screen the pages are a paper preview under a toolbar (Back, Print); the toolbar never prints.

   api = { ready() -> Promise (the files have settled), db() -> db | null, roster() -> [docs], me() -> id | null,
           isGM() -> bool, profiles(ids) -> Promise<{ id: name }>, back() } */
(function () {
  'use strict';
  var Sn = window.B68Season = {};
  var CT = window.B68Content || { byId: {}, PLAYBOOKS: [], PARANORMAL: [] };

  /* ---------- helpers ---------- */
  function A() { return window.B68 || {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clamp(n, a, b) { n = Math.round(+n || 0); return n < a ? a : n > b ? b : n; }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function slug(s) { return String(s || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'; }
  function day(iso) { var t = Date.parse(iso || ''); if (!t) return ''; try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return String(iso).slice(0, 10); } }
  function when(iso) { var t = Date.parse(iso || ''); if (!t) return ''; try { return day(iso) + ', ' + new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return day(iso); } }
  function pbOf(id) { return CT.byId[id] || null; }
  function pbName(d) { var p = pbOf(d.playbook); return d.playbookName || (p ? p.name + (p.subtitle ? ' · ' + p.subtitle : '') : d.playbook || ''); }

  /* ---------- the data ---------- */
  function campaignDoc(raw) {
    var M = window.B68Campaign;
    if (M && typeof M.normalize === 'function') { try { return M.normalize(raw ? clone(raw) : null); } catch (e) {} }
    var d = isObj(raw) ? clone(raw) : {};
    d.session = isObj(d.session) ? d.session : { number: 0 }; d.crew = isObj(d.crew) ? d.crew : {};
    d.clocks = Array.isArray(d.clocks) ? d.clocks : []; d.log = Array.isArray(d.log) ? d.log : [];
    return d;
  }
  function load(api) {
    var db = api.db ? api.db() : null;
    function roster() { try { return (api.roster && api.roster()) || []; } catch (e) { return []; } }
    if (!db) return Promise.resolve({ chars: roster(), camp: null, nodb: true });
    var chars = Promise.resolve().then(function () { var c = db.collection('characters'); return c && typeof c.get === 'function' ? c.get() : null; }).then(function (snap) {
      if (!snap || !Array.isArray(snap.docs)) return roster();
      return snap.docs.map(function (s) { var data = s && typeof s.data === 'function' ? s.data() : null; return isObj(data) ? Object.assign({ id: s.id }, data) : null; }).filter(Boolean);
    }).catch(function () { return roster(); });
    var camp = Promise.resolve().then(function () { var r = db.collection('campaign').doc('main'); return r && typeof r.get === 'function' ? r.get() : null; }).then(function (snap) {
      var data = snap && snap.exists !== false && typeof snap.data === 'function' ? snap.data() : null; return isObj(data) ? data : null;
    }).catch(function () { return null; });
    return Promise.all([chars, camp]).then(function (r) { return { chars: r[0], camp: r[1] }; });
  }
  /* rulebook order (core playbooks, then the paranormal four), then name */
  var ORDER = {}; (CT.PLAYBOOKS || []).concat(CT.PARANORMAL || []).forEach(function (p, i) { if (p && !(p.id in ORDER)) ORDER[p.id] = i; });
  function byPlaybook(a, b) {
    var oa = a.playbook in ORDER ? ORDER[a.playbook] : 999, ob = b.playbook in ORDER ? ORDER[b.playbook] : 999;
    if (oa !== ob) return oa - ob;
    var c = String(pbName(a)).localeCompare(String(pbName(b))); if (c) return c;
    return String(a.name || '').localeCompare(String(b.name || ''));
  }
  /* a doc filed without play gets the creator's starting play, as boot does when filing (nothing is saved here) */
  function prepared(d) {
    d = clone(d);
    if (!isObj(d.play)) { var T = window.B68Tracker; try { d.play = T && T.initialPlay ? T.initialPlay(clone(d.sheet || {}), d.playbook) : {}; } catch (e) { d.play = {}; } }
    return d;
  }
  /* first and last session dates: the log's "Session N started / ended" lines and the session record */
  function seasonOf(camp) {
    var s = camp.session || {}, ts = [];
    (camp.log || []).forEach(function (e) { if (e && /^Session \d+ (started|ended)\b/.test(String(e.text || ''))) { var t = Date.parse(e.at || ''); if (t) ts.push(t); } });
    [s.startedAt, s.endedAt].forEach(function (v) { var t = Date.parse(v || ''); if (t) ts.push(t); });
    ts.sort(function (a, b) { return a - b; });
    return { sessions: Math.max(0, +s.number || 0), first: ts.length ? new Date(ts[0]).toISOString() : null, last: ts.length ? new Date(ts[ts.length - 1]).toISOString() : null };
  }

  /* ---------- the campaign page's small renderers, as campaign.js draws them (read-only copies) ---------- */
  function box(title, body, right, cls) { return '<section class="tp-box' + (cls ? ' ' + cls : '') + '"><div class="tp-band"><span>' + title + '</span>' + (right ? '<span class="tp-band-r">' + right + '</span>' : '') + '</div><div class="tp-body">' + body + '</div></section>'; }
  function pips(n, filled, act, o) {
    o = o || {}; var h = '<span class="tp-pips' + (o.wrap ? ' ' + o.wrap : '') + '">';
    for (var i = 1; i <= n; i++) h += '<button type="button" class="' + (o.cls || 'tp-pip') + (i <= filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + i + '"' + (o.extra || '') + (o.dis ? ' disabled' : '') + ' aria-label="' + esc((o.label || act) + ' ' + i) + '" aria-pressed="' + (i <= filled) + '"></button>';
    return h + '</span>';
  }
  function input(path, value, ph, o) { o = o || {}; return '<input type="text" class="tp-in' + (o.cls ? ' ' + o.cls : '') + '" data-path="' + esc(path) + '" value="' + esc(value) + '"' + (o.label ? ' aria-label="' + esc(o.label) + '"' : '') + '>'; }
  function textarea(path, value, ph, o) { o = o || {}; return '<textarea class="tp-ta' + (o.cls ? ' ' + o.cls : '') + '" data-path="' + esc(path) + '"' + (o.label ? ' aria-label="' + esc(o.label) + '"' : '') + '>' + esc(value) + '</textarea>'; }
  function chip(label, act, pressed, extra, o) { o = o || {}; return '<button type="button" class="chip sm' + (o.cls ? ' ' + o.cls : '') + '" data-act="' + act + '"' + (extra || '') + (pressed != null ? ' aria-pressed="' + !!pressed + '"' : '') + '>' + label + '</button>'; }
  function clockSvg(size, filled, r, act, extra) {
    var cx = r, cy = r, R = r - 2, h = '', n = clamp(size, 2, 12);
    for (var i = 0; i < n; i++) {
      var a0 = -Math.PI / 2 + i * 2 * Math.PI / n, a1 = a0 + 2 * Math.PI / n;
      var x0 = (cx + R * Math.cos(a0)).toFixed(2), y0 = (cy + R * Math.sin(a0)).toFixed(2), x1 = (cx + R * Math.cos(a1)).toFixed(2), y1 = (cy + R * Math.sin(a1)).toFixed(2);
      h += '<path class="tp-seg' + (i < filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + (i + 1) + '"' + (extra || '') + ' d="M' + cx + ' ' + cy + ' L' + x0 + ' ' + y0 + ' A' + R + ' ' + R + ' 0 0 1 ' + x1 + ' ' + y1 + ' Z"><title>' + (i + 1) + ' / ' + n + '</title></path>';
    }
    return '<svg class="tp-clocksvg" viewBox="0 0 ' + 2 * r + ' ' + 2 * r + '" width="' + 2 * r + '" height="' + 2 * r + '" role="img" aria-label="clock ' + filled + ' of ' + n + '">' + h + '<circle class="tp-rim" cx="' + cx + '" cy="' + cy + '" r="' + R + '"/></svg>';
  }
  function noop() {}
  /* the ctx the crew panel renders with (campaign.js crewCtx), with nothing that can act */
  function crewCtx(isGM, me) {
    return { can: function () { return false; }, esc: esc, box: box, pips: pips, input: input, draftInput: function (ui, ph, o) { return input('', '', ph, o); }, textarea: textarea, chip: chip, clockSvg: clockSvg,
      commit: noop, confirm: function () { return false; }, draft: function () { return ''; }, setDraft: noop, focus: noop, me: me || null, isGM: !!isGM };
  }

  /* ---------- pages ---------- */
  var cur = null;   /* { api, root, pages, links: [Promise] } */
  function bar(ready, count) {
    return '<div class="sn-bar" role="toolbar" aria-label="Season print"><button type="button" class="btn sm" data-sn="back">← Back</button>' +
      '<span class="sn-bar-t"><b>Season print</b><span class="sn-bar-n mono">' + (ready ? count + ' section' + (count === 1 ? '' : 's') + ' · prints on white, one per page' : 'gathering…') + '</span></span>' +
      '<button type="button" class="btn sm primary" data-sn="print"' + (ready ? '' : ' disabled') + '>Print</button></div>';
  }
  function setNote(msg, bad) { if (!cur) return; var p = cur.root.querySelector('.sn-pages'); if (p) p.innerHTML = '<div class="sn-note' + (bad ? ' bad' : '') + '">' + esc(msg) + '</div>'; }
  /* every stylesheet the page uses, so a shadow copy is styled exactly like the live sheet */
  function styleNodes() { return [].slice.call(document.querySelectorAll('link[rel~="stylesheet"], style')).filter(function (n) { return !n.closest || !n.closest('#season'); }); }
  function loaded(link) {
    return new Promise(function (res) { var done = false; function ok() { if (!done) { done = true; res(); } } link.addEventListener('load', ok); link.addEventListener('error', ok); setTimeout(ok, 4000); });
  }
  function page(cls, label) {
    var pg = el('article', 'sn-page ' + cls); pg.setAttribute('aria-label', label);
    cur.pages.appendChild(pg); return pg;
  }
  /* a page whose content lives in a shadow root carrying the page's stylesheets */
  function shadowPage(cls, label) {
    var pg = page(cls, label), host = el('div', 'sn-host'); pg.appendChild(host);
    var sr = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
    if (sr) styleNodes().forEach(function (n) { var c = n.cloneNode(true); if (c.tagName === 'LINK') cur.links.push(loaded(c)); sr.appendChild(c); });
    return { page: pg, root: sr || host, shadow: !!sr };
  }
  /* copies are for reading: the root is inert (nothing focuses or acts, and no listener is attached anyway; controls keep
     the look a writer's print has), and text fields become plain text in the field's own box, so an empty field prints
     blank and long text wraps and grows instead of being clipped by an input or a fixed-height textarea */
  function settle(root) {
    root.setAttribute('inert', '');
    root.querySelectorAll('input, textarea').forEach(function (t) {
      if (t.tagName === 'INPUT' && t.type && t.type !== 'text') return;
      var d = el(t.tagName === 'TEXTAREA' ? 'div' : 'span', t.className + (t.tagName === 'TEXTAREA' ? ' sn-ta' : ' sn-in')); d.textContent = t.value;
      ['data-path', 'aria-label'].forEach(function (a) { if (t.getAttribute(a)) d.setAttribute(a, t.getAttribute(a)); });
      t.parentNode.replaceChild(d, t);
    });
  }

  function cover(camp, chars, season) {
    var crew = camp.crew || {}, CR = window.B68Crews, rec = CR && CR.byId && crew.playbook ? CR.byId[crew.playbook] : null;
    var CS = window.B68Campaign && window.B68Campaign.crewSheet, lk = rec && CS && CS.look ? CS.look(rec.id) : null;
    var pg = page('sn-cover', 'Cover');
    if (lk) pg.style.cssText = '--duo-a:' + lk.duo[0] + ';--duo-b:' + lk.duo[1];
    var facts = [
      ['Season', season.sessions ? season.sessions + ' session' + (season.sessions === 1 ? '' : 's') : 'not started'],
      ['First session', season.first ? day(season.first) : '—'],
      ['Last session', season.last ? day(season.last) : '—'],
      ['Printed', day(new Date().toISOString())],
      ['On file', chars.length + ' character' + (chars.length === 1 ? '' : 's')]
    ];
    var h = '<div class="sn-mast"><span class="sn-kick">Blades ’68 · the season</span><h1 class="sn-crewname">' + esc(crew.name || 'An unnamed crew') + '</h1>' +
      '<span class="sn-crewpb">' + esc(rec ? rec.name + ' · ' + rec.tagline : crew.type || 'No crew playbook chosen') + '</span>' +
      '<span class="sn-crewtier mono">Tier ' + clamp(crew.tier, 0, 6) + ' · ' + esc(crew.hold === 'strong' ? 'strong' : 'weak') + ' hold</span></div>' +
      '<dl class="sn-facts">' + facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') + '</dl>' +
      '<section class="sn-lineup" aria-label="The crew line-up"><div class="sn-lh"><span>The crew</span><span class="sn-dim">True height · 25 units per inch</span></div><div class="sn-chart"></div><div class="sn-names"></div></section>' +
      '<section class="sn-toc" aria-label="Contents"><div class="sn-lh"><span>In this file</span></div><ol><li><b>The crew</b><span>crew sheet, shared clocks, campaign log</span></li>' +
      chars.map(function (d) { return '<li><b>' + esc(d.name || 'Unnamed') + '</b><span>' + esc([d.alias, pbName(d)].filter(Boolean).join(' · ')) + '</span></li>'; }).join('') + '</ol></section>';
    pg.innerHTML = h;
    lineup(pg.querySelector('.sn-chart'), pg.querySelector('.sn-names'), chars);
  }
  /* the line-up at true height, as boot.js draws the crew line-up, over every filed character with a figure */
  function lineup(chart, names, chars) {
    var K = window.B68Figure, list = chars.filter(function (d) { return isObj(d.spec); });
    if (!K || typeof K.lineup !== 'function' || !list.length) { chart.innerHTML = '<p class="sn-dim">' + (list.length ? 'The figure kit is missing.' : 'No figures on file.') + '</p>'; return; }
    try {
      var specs = list.map(function (d, i) { var s = clone(d.spec); s.id = 'sn' + i + '-' + slug(d.name); s.name = d.name; s.playbook = pbName(d); return s; });
      var r = K.lineup(specs, { chart: true, height: 380, lod: 'lo' });
      chart.innerHTML = r.svg; var svg = chart.querySelector('svg'); if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
      if (svg) list.forEach(function (d, i) { var p = pbOf(d.playbook); if (!p || !p.ghost) return; svg.querySelectorAll('.b68-figure').forEach(function (g) { if (g.getAttribute('data-id') === specs[i].id) g.classList.add('ghostly'); }); });
      names.innerHTML = specs.map(function (s) { return '<span>' + esc(s.name || 'Unnamed') + '<small>' + esc((s.playbook || '') + (A().feet ? ' · ' + A().feet(s.heightIn) : '')) + '</small></span>'; }).join('');
    } catch (e) { chart.innerHTML = '<p class="sn-dim">The line-up could not be drawn: ' + esc(e.message) + '</p>'; }
  }

  function crewPage(camp, isGM, me, names) {
    var sp = shadowPage('sn-crew', 'The crew'), crew = camp.crew || {}, M = window.B68Campaign || {}, CS = M.crewSheet, s = camp.session || {};
    var sec = el('section', 'tp tp-gm'); sec.id = 'table-page'; sec.setAttribute('aria-label', 'The crew');
    if (!sp.shadow) sec.removeAttribute('id');
    var panel = '';
    try { panel = CS && typeof CS.render === 'function' ? CS.render(clone(crew), crewCtx(isGM, me)) : M.genericCrewPanel ? M.genericCrewPanel.render(clone(crew), crewCtx(isGM, me)) : ''; }
    catch (e) { panel = box('The crew', '<p class="hint bad">The crew sheet could not be drawn: ' + esc(e.message) + '</p>'); }
    var sub = [crew.type, 'Tier ' + clamp(crew.tier, 0, 6) + ' · ' + (crew.hold === 'strong' ? 'strong' : 'weak') + ' hold', s.number ? 'session ' + s.number : ''].filter(Boolean).join(' · ');
    sec.innerHTML = '<header class="tp-head"><div class="tp-title"><span class="tp-kick">The crew</span><h2 class="tp-crewname">' + esc(crew.name || 'An unnamed crew') + '</h2><span class="tp-subtitle">' + esc(sub) + '</span></div></header>' +
      '<div class="tp-grid"><div class="tp-col tp-colA">' + panel + '</div><div class="tp-col tp-colB">' + clocks(camp, isGM) + '</div></div>' + logBox(camp, names);
    sp.root.appendChild(sec); settle(sec);
  }
  function clocks(camp, isGM) {
    var all = camp.clocks || [], list = all.filter(function (c) { return isGM || !c.hidden; }), h = '<div class="tp-clocks">';
    list.forEach(function (c) {
      var size = clamp(c.size, 2, 12), filled = clamp(c.filled, 0, size), kind = String(c.kind || 'other');
      h += '<div class="tp-clock' + (c.hidden ? ' hid' : '') + (filled >= size ? ' full' : '') + '">' + clockSvg(size, filled, 34, 'clockfill') +
        '<div class="tp-clockmeta"><b class="sn-clockname">' + esc(c.name || 'Unnamed clock') + '</b><div class="tp-clockline"><span class="mono">' + filled + ' / ' + size + '</span><span class="tp-kind k-' + esc(kind) + '">' + esc(kind) + '</span>' +
        (c.hidden ? '<span class="tp-hidtag">hidden from players</span>' : '') + (filled >= size ? '<span class="tp-fulltag">full</span>' : '') + '</div></div></div>';
    });
    if (!list.length) h += '<p class="hint">No shared clocks.</p>';
    h += '</div>';
    var hid = all.filter(function (c) { return c.hidden; }).length;
    return box('Shared clocks', h, '<span class="tp-dim">' + list.length + ' clock' + (list.length === 1 ? '' : 's') + (isGM && hid ? ' · ' + hid + ' hidden' : '') + '</span>', 'tp-clockbox');
  }
  function logBox(camp, names) {
    var log = (camp.log || []).filter(isObj).slice().sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); }), h = '<ol class="tp-log">';
    log.forEach(function (e) { h += '<li><span class="tp-logd mono">' + esc(when(e.at) || '—') + '</span><span class="tp-logt">' + esc(e.text) + '</span><span class="tp-logby">' + esc(e.by ? names[e.by] || '' : '') + '</span></li>'; });
    h += '</ol>' + (!log.length ? '<p class="hint">Nothing logged.</p>' : '');
    return box('Campaign log', h, '<span class="tp-dim">newest first' + (log.length ? ' · ' + log.length : '') + '</span>', 'tp-logbox');
  }

  function sheetPage(d) {
    var T = window.B68Tracker, label = (d.name || 'Unnamed') + ' · ' + pbName(d);
    var sp = shadowPage('sn-char', label); sp.page.setAttribute('data-id', d.id || '');
    var sec = el('section', 'dossier'); sec.id = 'dossier'; sec.setAttribute('aria-label', label);
    if (!sp.shadow) sec.removeAttribute('id');
    sp.root.appendChild(sec);
    if (!T || typeof T.renderStatic !== 'function') { sec.innerHTML = '<p class="hint">The sheet module is missing.</p>'; return; }
    try { T.renderStatic(sec, d); } catch (e) { sec.innerHTML = '<p class="hint">' + esc(label) + ': the sheet could not be drawn (' + esc(e.message) + ').</p>'; return; }
    settle(sec);
  }

  function draw(data) {
    var api = cur.api, isGM = false, me = null;
    try { isGM = !!(api.isGM && api.isGM()); me = api.me ? api.me() : null; } catch (e) {}
    var camp = campaignDoc(data.camp), chars = (data.chars || []).filter(function (d) { return isObj(d) && (d.playbook || d.sheet || d.spec); }).map(prepared).sort(byPlaybook);
    var c = cur, ids = {};
    camp.log.forEach(function (e) { if (e && e.by) ids[e.by] = 1; });
    var want = Object.keys(ids);
    var names = want.length && api.profiles ? Promise.resolve().then(function () { return api.profiles(want); }).catch(function () { return {}; }) : Promise.resolve({});
    return names.then(function (map) {
      if (cur !== c) return;
      var nm = {}; if (isObj(map)) Object.keys(map).forEach(function (k) { var v = map[k]; nm[k] = typeof v === 'string' ? v : v ? v.name || v.email || '' : ''; });
      c.pages.innerHTML = '';
      cover(camp, chars, seasonOf(camp));
      crewPage(camp, isGM, me, nm);
      chars.forEach(sheetPage);
      if (data.nodb) c.pages.insertBefore(el('div', 'sn-note', esc('The table is not available in this view, so the crew and the clocks are empty.')), c.pages.firstChild);
      return Promise.all(c.links).then(function () {
        if (cur !== c) return;
        var n = c.pages.querySelectorAll('.sn-page').length;
        c.root.querySelector('.sn-bar').outerHTML = bar(true, n);
        c.root.dataset.state = 'ready';
      });
    });
  }

  /* ---------- API ---------- */
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-sn]') : null; if (!t || !cur || t.disabled) return;
    if (t.dataset.sn === 'back') { if (cur.api.back) cur.api.back(); }
    else if (t.dataset.sn === 'print') { try { window.print(); } catch (err) {} }
  }
  Sn.render = function (api) {
    var root = document.getElementById('season'); if (!root) return;
    if (cur) Sn.close();
    cur = { api: api || {}, root: root, links: [], pages: null };
    root.className = 'sn'; root.dataset.state = 'loading';
    root.innerHTML = bar(false) + '<div class="sn-pages"><div class="sn-note">Gathering the season…</div></div>';
    cur.pages = root.querySelector('.sn-pages');
    root.addEventListener('click', onClick);
    var c = cur;
    Promise.resolve().then(function () { return c.api.ready ? c.api.ready() : null; }).then(function () { return cur === c ? load(c.api) : null; })
      .then(function (data) { if (cur === c && data) return draw(data); })
      .catch(function (e) { if (cur !== c) return; setNote('The season could not be gathered: ' + (e && e.message || e), true); c.root.dataset.state = 'failed'; if (window.console) console.error(e); });
  };
  Sn.close = function () {
    if (!cur) return; var c = cur; cur = null;
    c.root.removeEventListener('click', onClick);
    c.root.innerHTML = ''; c.root.className = 'sn'; delete c.root.dataset.state;
  };
  Sn.isOpen = function () { return !!cur; };
  /* open the print from anywhere in the app; Back returns there */
  Sn.open = function () { if (A().openPrint) A().openPrint(); else { try { location.hash = '#print'; } catch (e) {} } };
})();
