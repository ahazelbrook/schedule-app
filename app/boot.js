/* Boot: the step rail, navigation, the crew line-up, the files (characters collection, account, modes and routing), the table page (campaign/main), exports, and hot reload. */
(function () {
  'use strict';
  var A = window.B68; if (!A || !A.K || !A.SECTIONS) return;
  var K = A.K, C = A.C, S = A.S, $ = A.$, el = A.el, esc = A.esc, clone = A.clone, toast = A.toast;
  var hot = window.claude && window.claude.hot;
  var N = A.SECTIONS.length;

  /* ---------- build the panels, tabs and rail ---------- */
  var panels = $('panels'), tabsEl = $('tabs'), rail = $('rail');
  A.SECTIONS.forEach(function (s, i) {
    var p = el('div', 'panel'); p.id = 'panel-' + i; p.setAttribute('role', 'tabpanel');
    s.build().forEach(function (c) { p.appendChild(c); }); panels.appendChild(p);
    var t = el('button', 'tab', esc(s.name)); t.type = 'button'; t.setAttribute('role', 'tab'); t.id = 'tab-' + i; t.onclick = function () { showStep(i); }; tabsEl.appendChild(t);
    var r = el('button', null, '<span class="n">' + (i + 1) + '</span><span>' + esc(s.name) + '</span>'); r.type = 'button'; r.onclick = function () { showStep(i); }; rail.appendChild(r);
  });
  function stepDone(i) {
    var sh = S.sheet, p = A.pbOf();
    switch (i) {
      case 0: return !!p;
      case 7: return !!p && (p.hull ? !!sh.owning : !!sh.heritage && (p.altBackground ? (sh.alt || []).length > 0 : !!sh.background));
      case 8: return !!p && A.dotsTotal() === p.dots;
      case 9: return !!p && (p.paranormal ? !!sh.ability && (sh.ability !== 'Versatile' || !!sh.customAbility) && (!p.vampire || sh.ability === 'Versatile' || !!sh.stricture) : !!(sh.ability || sh.customAbility));
      case 10: { if (!p) return false; if (p.hull) return true; var ks = (sh.keys || []).concat(sh.customKey ? [sh.customKey] : []); if (p.vampire) { var kl = sh.keyLocks || {}; return ks.length === 4 && ks.every(function (k) { return kl[k] === 'down' || kl[k] === 'up'; }); } return ks.length >= 2 && ks.length <= 4; }
      case 11: { if (!p) return false; if (p.hull || p.ghost || p.timetraveler) return true; var c = sh.contacts || {}; if (p.vampire) return Object.keys(c).filter(function (k) { return c[k] === 'friend'; }).length >= 2; return Object.keys(c).length >= 2; }
      case 12: return !!p && (p.hull || p.ghost ? true : p.vampire ? (!!sh.feeding && !!sh.telltale) : p.timetraveler ? !!sh.mission : (!!sh.vice && !!sh.purveyor));
      case 13: return !!p && (p.ghost ? !!sh.ghostItems : (sh.items || []).length > 0);
      case 14: return !!sh.name;
      default: return S.dirty && !!p;
    }
  }
  function showStep(i) {
    S.step = Math.max(0, Math.min(N - 1, i));
    tabsEl.querySelectorAll('.tab').forEach(function (t, j) { t.setAttribute('aria-selected', String(j === S.step)); });
    panels.querySelectorAll('.panel').forEach(function (p, j) { p.classList.toggle('on', j === S.step); });
    $('panelTitle').textContent = A.SECTIONS[S.step].name; $('panelFolio').textContent = (S.step + 1) + ' / ' + N;
    $('back').disabled = S.step === 0; $('next').textContent = S.step === N - 1 ? 'Done' : 'Next';
    $('shuffle').hidden = !A.shuffleStep.has(S.step);
    /* the Face step: keep the figure view and frame the head large; every other step fits the whole figure */
    if (S.view !== 'figure' && S.step < 15) setView('figure');
    if (window.B68Zoom) { if (S.step === 2) { if (!faceFramed) { faceFramed = true; setTimeout(function () { try { window.B68Zoom.toFace({ heads: 2.1 }); } catch (e) {} }, 0); } } else if (faceFramed) { faceFramed = false; try { window.B68Zoom.reset(); } catch (e) {} } }
    syncRail(); A.syncAll();
    var r = rail.children[S.step]; if (r && r.scrollIntoView) { try { r.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} }
    if (A.snapshot) A.snapshot();
  }
  A.showStep = showStep;
  function syncRail() { rail.querySelectorAll('button').forEach(function (b, j) { if (j === S.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); b.classList.toggle('done', j !== S.step && stepDone(j)); }); }
  A.onChange = syncRail;
  A.shuffleStep.has = function (i) { return [1, 2, 3, 4, 6, 14].indexOf(i) >= 0; };
  $('back').onclick = function () { showStep(S.step - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  $('next').onclick = function () { if (S.step === N - 1) { var v = A.validate(); var bad = v.filter(function (c) { return !c.ok; }); toast(bad.length ? bad.length + ' thing' + (bad.length > 1 ? 's' : '') + ' still to do, listed above.' : 'Complete. File the character or save the files.', bad.length > 0); return; } if (S.step === 0 && !A.pbOf()) { toast('Pick a playbook first.', true); return; } showStep(S.step + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  $('shuffle').onclick = function () { if (A.shuffleStep(S.step)) toast('Shuffled.'); };
  var faceFramed = false;
  function setView(v) { S.view = v; $('viewFigure').setAttribute('aria-pressed', String(v === 'figure')); $('viewMug').setAttribute('aria-pressed', String(v === 'mug')); A.draw(); }
  [$('viewFigure'), $('viewMug')].forEach(function (b) { b.onclick = function () { setView(b.dataset.view); }; });

  /* ---------- the crew line-up ---------- */
  var roster = [], lineKey = null;
  A.drawLineup = function () {
    try {
      var you = A.renderSpec(); you.id = (you.id || 'you') + '-lu';
      var others = roster.length ? roster.slice(0, 6).map(function (d, i) { var s = clone(d.spec); s.id = 'r' + i + '-' + A.slug(d.name); s.name = d.name; s.playbook = d.playbookName || d.playbook; return s; }) : C.pcs.map(function (c) { return clone(c); });
      var all = others.concat([you]);
      /* the same figures as the last line-up (a sheet edit, not a figure edit): leave the drawing alone */
      var lkey = JSON.stringify(all) + '|' + roster.length;
      if (lkey === lineKey && $('lineup').firstChild) return;
      var r = K.lineup(all, { chart: true, height: 380, lod: 'lo' });
      lineKey = lkey;
      $('lineup').innerHTML = r.svg; var svg = $('lineup').querySelector('svg'); if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
      /* ghosts read as vapour: class the figure group of each Ghost/Echo in the line-up */
      var ghosts = {}; if (roster.length) roster.slice(0, 6).forEach(function (d, i) { var q = A.CT.byId[d.playbook]; if (q && q.ghost) ghosts['r' + i + '-' + A.slug(d.name)] = true; }); var mine = A.pbOf(); if (mine && mine.ghost) ghosts[you.id] = true;
      if (svg) Object.keys(ghosts).forEach(function (id) { svg.querySelectorAll('.b68-figure').forEach(function (g) { if (g.getAttribute('data-id') === id) g.classList.add('ghostly'); }); });
      $('lineupNames').innerHTML = all.map(function (c, i) { var last = i === all.length - 1; return '<span' + (last ? ' class="you"' : '') + '>' + esc(last ? (S.sheet.name || 'You') : c.name) + '<small>' + esc(last ? ((A.pbOf() || {}).name || 'the subject') : (c.playbook || '')) + ' · ' + A.feet(c.heightIn) + '</small></span>'; }).join('');
      $('crewNote').textContent = 'True height · 25 units per inch · ' + (roster.length ? 'the filed crew, then you' : 'the canon crew, then you');
    } catch (e) { lineKey = null; $('lineup').innerHTML = '<div class="empty">The line-up could not be drawn: ' + esc(e.message) + '</div>'; }
  };

  /* ---------- the files: the characters collection, account, modes and routing ---------- */
  var db = null, dbSettled = false, chars = null;          /* chars: the collection handle */
  var openId = null, openUnsub = null, latest = null;      /* the character open in the sheet; latest = its newest data (no id) */
  var cache = {};                                           /* id -> data, from the collection snapshot */
  var filter = 'all', filterChosen = false, pendingOpen = null;
  A.me = null; A.canWrite = null; A.isGM = false; A.isDisplay = false; A.roleKnown = false;   /* roleKnown: a signed-in user answered, so isGM is a fact */
  var userCap = null;                                       /* the user capability, for profiles */
  A.filingAvailable = function () { return !!db; };
  function nowIso() { return new Date().toISOString(); }
  function tracker() { var T = window.B68Tracker; return T && typeof T.open === 'function' ? T : null; }
  function pbName(id) { var p = A.CT.byId[id]; return p ? p.name + (p.subtitle ? ' · ' + p.subtitle : '') : (id || ''); }
  function col() { return chars || (chars = db.collection('characters')); }

  function normaliseSheet(sheet, d) {
    var sh = Object.assign(A.blankSheet(), clone(sheet || {}));
    if (Array.isArray(sh.wearing)) sh.wearing = sh.wearing.join(', ');
    if (!sh.playbook && d && d.playbook) sh.playbook = d.playbook;
    if (!sh.name && d && d.name) sh.name = d.name;
    return sh;
  }
  /* step: where the creator opens (the File step unless told; Edit figure opens at Build) */
  function loadIntoCreator(d, step) {
    S.spec = clone(d.spec || A.BASE_FIGURE); if (!S.spec.props) S.spec.props = [];
    S.sheet = normaliseSheet(d.sheet, d); S.sheet.docId = d.id; S.dirty = true;
    A.changed(); showStep(step == null ? 15 : step); syncEditBar(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  A.loadIntoCreator = loadIntoCreator;
  /* Edit figure (a card, the sheet): the filed character in the creator at the Build step, under the editing banner */
  function editFigure(d) {
    var dr = draftInfo(); if (dr && !window.confirm('Edit ' + (d.name || 'this character') + '? Your draft (' + dr + ') in the creator is cleared.')) return;
    setMode('create'); loadIntoCreator(d, 1);
    toast('Editing ' + (d.name || 'the character') + '. Update the file when you are done.');
  }

  /* mode: home (#home: the start page and the files), create (the studio and line-up), sheet (the tracker in #dossier),
     table (the campaign page in #table-page), print (the season print in #season, season.js), cast (the NPCs in #cast-page, cast-page.js),
     gm (the GM's page in #gm-page, gm-page.js) or display (the iPad's full-screen view in #display-page, display-page.js).
     Every mode has a hash, and a switch pushes one history entry (quiet: the hash already says so, or boot). */
  var MODES = { home: 1, create: 1, sheet: 1, table: 1, print: 1, rules: 1, cast: 1, gm: 1, display: 1 };
  function setMode(m, quiet) {
    m = MODES[m] ? m : 'home';
    if (A.isDisplay === true) m = 'display';   /* the table iPad's own sign-in shows the display and nothing else */
    var was = document.body.dataset.mode;
    document.body.dataset.mode = m;
    var hm = $('home'); if (hm) hm.hidden = m !== 'home';
    var dos = $('dossier'); if (dos) dos.hidden = m !== 'sheet';
    var tp = $('table-page'); if (tp) tp.hidden = m !== 'table';
    var sn = $('season'); if (sn) sn.hidden = m !== 'print';
    var rp = $('rules-page'); if (rp) rp.hidden = m !== 'rules';
    var cp = $('cast-page'); if (cp) cp.hidden = m !== 'cast';
    var gp = $('gm-page'); if (gp) gp.hidden = m !== 'gm';
    var dp = $('display-page'); if (dp) dp.hidden = m !== 'display';
    if (m !== 'sheet' && was === 'sheet') closeSheet();
    if (m !== 'table' && was === 'table') closeTable();
    if (m === 'table' && was !== 'table') startTable();
    if (m !== 'print' && was === 'print') closePrint();
    if (m === 'print' && was !== 'print') startPrint();
    if (m !== 'rules' && was === 'rules') closeRules();
    if (m === 'rules' && was !== 'rules') startRules();
    if (m !== 'cast' && was === 'cast') closeCast();
    if (m === 'cast' && was !== 'cast') startCast();
    if (m !== 'gm' && was === 'gm') closeGm();
    if (m === 'gm' && was !== 'gm') startGm();
    if (m !== 'display' && was === 'display') closeDisplay();
    if (m === 'display' && was !== 'display') startDisplay();
    if (m === 'home' && was !== 'home') renderHome();
    if (!quiet) syncHash(m);
    syncNav(); syncEditBar();
    if (was && was !== m) focusView();
    if (A.snapshot) A.snapshot();
  }
  A.setMode = setMode;
  function closeSheet() {
    if (openUnsub) { try { openUnsub(); } catch (e) {} openUnsub = null; }
    var T = tracker(); if (T && T.isOpen && T.isOpen()) { try { T.close(); } catch (e) {} }
    openId = null; latest = null;
  }

  /* the header: the wordmark's subtitle and the tab title name the view; the nav marks where you are */
  function viewName() {
    var m = document.body.dataset.mode;
    if (m === 'table') return 'The table';
    if (m === 'print') return 'The season print';
    if (m === 'rules') return 'Rules';
    if (m === 'cast') return 'The cast';
    if (m === 'gm') return 'GM console';
    if (m === 'display') return 'The display';
    if (m === 'sheet') return ((openId && (latest || cache[openId])) || {}).name || 'A character';
    if (m === 'create') return S.sheet && S.sheet.docId ? 'Editing ' + (S.sheet.name || 'a character') : 'New character';
    return 'Home';
  }
  function syncTitle() {
    var n = viewName(), v = $('viewName'); if (v) v.textContent = n;
    try { document.title = n === 'Home' ? 'Blades ’68' : n + ' · Blades ’68'; } catch (e) {}
  }
  /* "Your sheet": only when the viewer owns exactly one character */
  function mineOnly() { if (!A.me) return null; var m = roster.filter(function (d) { return d.owner === A.me; }); return m.length === 1 ? m[0] : null; }
  function syncNav() {
    var m = document.body.dataset.mode, one = mineOnly();
    var rb = $('rulesBtn'); if (rb) rb.hidden = !rulesOn();
    var gb = $('gmBtn'); if (gb) gb.hidden = !gmOn();
    var mb = $('mineBtn'); if (mb) { mb.hidden = !one; if (one) mb.title = 'Open ' + (one.name || 'your character'); }
    [['homeBtn', m === 'home'], ['tableBtn', m === 'table'], ['rulesBtn', m === 'rules'], ['gmBtn', m === 'gm'], ['mineBtn', m === 'sheet' && !!one && openId === one.id]].forEach(function (x) { var b = $(x[0]); if (!b) return; if (x[1]) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    syncTitle();
  }
  /* a11y: after a switch, focus lands on the view's title (Home's heading, else the header's view name) */
  function focusView() {
    var t = document.body.dataset.mode === 'home' && $('homeTitle') || $('viewName');
    if (t && t.focus) { try { t.focus({ preventScroll: true }); } catch (e) {} }
  }
  /* the creator's banner while it holds a filed character */
  function syncEditBar() {
    var b = $('editBar'); if (!b) return;
    var on = document.body.dataset.mode === 'create' && !!(S.sheet && S.sheet.docId) && !!db;
    b.hidden = !on; if (on) $('editName').textContent = S.sheet.name || 'the character';
    if (document.body.dataset.mode === 'create') syncTitle();
  }

  /* history: each entry this page makes carries { b68: depth }; depth 0 is the entry the visit started on, so Back can
     tell an in-app previous entry (history.back()) from leaving the app (Home instead, replacing this entry) */
  var depth = 0, noState = false;
  function stamp() { try { history.replaceState({ b68: depth }, '', location.href); } catch (e) { noState = true; } }
  function pushHash(h) {
    if (h) { try { location.hash = h; } catch (e) {} return; }   /* the hashchange stamps the new entry */
    try { history.pushState({ b68: depth + 1 }, '', location.pathname + location.search); depth++; } catch (e) { try { location.hash = ''; } catch (e2) {} }
  }
  function replaceHash(h) { try { history.replaceState({ b68: depth }, '', h || location.pathname + location.search); } catch (e) { noState = true; } }
  function isShare(h) { return h.length > 24 && h[1] === 's'; }
  function hashFor(m) { return m === 'sheet' ? (openId ? '#c/' + openId : null) : m === 'table' ? '#t' : m === 'print' ? '#print' : m === 'rules' ? '#rules' : m === 'cast' ? '#cast' : m === 'gm' ? '#gm' : m === 'display' ? '#display' : m === 'create' ? '#create' : ''; }
  function syncHash(m) {
    var h = location.hash || '', want = hashFor(m);
    if (want === null || h === want || (!want && h === '#')) return;
    if (m === 'table' && h.indexOf('#t/') === 0) return;
    if (m === 'rules' && isRulesHash(h)) return;
    if (m === 'cast' && (h === '#cast' || h.indexOf('#cast/') === 0)) return;
    if (m === 'create' && (h === '#new' || isShare(h))) return;
    pushHash(want);
  }
  /* Back (the sheet's, the print's): the previous view when it is this app's, else Home */
  function goBack() {
    if (depth > 0 && !noState) { try { history.back(); return; } catch (e) {} }
    goHome(true);
  }
  function goHome(replace) { setMode('home', !!replace); if (replace) replaceHash(''); window.scrollTo(0, 0); }
  A.goHome = function () { goHome(false); };

  /* A save from the sheet sends only what changed, so a player and the GM editing the same character at once
     do not overwrite each other's marks. Each changed top-level field of play is sent whole (arrays and scalars
     replace on the server); an object field that lost a key, or any doubt, falls back to a full set (returns null). */
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function playDelta(before, patch) {
    var out = {}, any = false;
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      if (k !== 'play') { if (!same(patch[k], before[k])) { out[k] = patch[k]; any = true; } continue; }
      var np = patch.play || {}, op = before.play;
      if (!op || typeof op !== 'object') return null;
      var pd = {}, pany = false;
      for (var f in op) if (Object.prototype.hasOwnProperty.call(op, f) && !(f in np)) return null;
      for (var g in np) {
        if (!Object.prototype.hasOwnProperty.call(np, g) || same(np[g], op[g])) continue;
        var nv = np[g], ov = op[g];
        if (nv && ov && typeof nv === 'object' && typeof ov === 'object' && !Array.isArray(nv)) { for (var h in ov) if (!(h in nv)) return null; }
        pd[g] = nv; pany = true;
      }
      if (pany) { out.play = pd; any = true; }
    }
    if (!any) return null;
    out.updatedAt = nowIso();
    return out;
  }
  function openCharacter(id) {
    if (!id) return;
    if (!db) { pendingOpen = id; if (dbSettled) toast('Saved characters are not available in this view.', true); return; }
    var T = tracker(); if (!T) { toast('The sheet module is missing.', true); return; }
    if (openId === id && T.isOpen && T.isOpen()) { setMode('sheet'); return; }
    closeSheet(); openId = id; latest = null;
    var ref = col().doc(id), first = true;
    var api = {
      save: function (patch) {
        if (!db || openId !== id) return Promise.reject(new Error('The sheet is closed.'));
        var before = latest || {};
        latest = Object.assign({}, before, patch || {}, { updatedAt: nowIso() });
        cache[id] = latest;
        var delta = playDelta(before, patch || {});
        var write = delta && typeof ref.update === 'function' ? ref.update(clone(delta)) : ref.set(clone(latest));
        return write.catch(function (e) { toast('Could not save: ' + (e && e.message || e), true); throw e; });
      },
      edit: function () { editFigure(Object.assign({ id: id }, latest || cache[id] || {})); },
      back: function () { goBack(); },
      remove: function () { var r2 = ref; return r2.delete().then(function () { delete cache[id]; toast('Removed.'); goBack(); }).catch(function (e) { toast('Could not remove: ' + (e && e.message || e), true); throw e; }); },
      me: A.me,
      /* per document, as the server decides: a player writes only their own (or an unowned) sheet, the GM any */
      get canWrite() { var d = latest || cache[id] || {}; return A.canWrite === false ? false : (A.isGM || !d.owner || d.owner === A.me) ? A.canWrite : false; },
      /* the table's session, null without a started table (boot calls B68Tracker.refresh when it changes) */
      table: function () {
        var t = campLoaded && tableExists && isObj(tableLatest) ? tableLatest : null, s = t && isObj(t.session) ? t.session : {};
        if (!t || (window.B68Runtime && window.B68Runtime.kind === 'cloudflare' && !t.updatedAt)) return null;
        var n = Math.max(0, Math.floor(+s.number || 0)); return { session: n, inPlay: n > 0 && !!s.startedAt && !s.endedAt };
      },
      profiles: userCap && typeof userCap.profiles === 'function' ? profiles : null
    };
    function arrived(data) {
      if (openId !== id) return;
      if (!data) { toast(first ? 'That character was not found.' : 'This character was removed.', true); goBack(); return; }
      latest = data; cache[id] = data;
      var doc = Object.assign({ id: id }, clone(data));
      try { if (first) { first = false; T.open(doc, api); } else if (T.update) T.update(doc); syncTitle(); }
      catch (e) { toast('The sheet could not render: ' + (e && e.message || e), true); }
    }
    if (typeof ref.onSnapshot === 'function') {
      try { openUnsub = ref.onSnapshot(function (snap) { arrived(snap && (snap.exists === false ? null : (typeof snap.data === 'function' ? snap.data() : snap))); }, function (e) { toast('Files offline: ' + (e && e.message || e), true); }); } catch (e) { openUnsub = null; }
    }
    if (!openUnsub) {
      /* no per-doc subscription: read once, then follow the collection snapshot cache */
      var p = typeof ref.get === 'function' ? ref.get() : Promise.resolve(null);
      p.then(function (snap) { arrived(snap && snap.exists !== false && typeof snap.data === 'function' ? snap.data() : (cache[id] || null)); }).catch(function (e) { toast('Could not open: ' + (e && e.message || e), true); });
      openUnsub = function () {};
      A._followCache = function (did) { if (did === id && openId === id && !first) arrived(cache[id] || null); };
    } else A._followCache = null;
    setMode('sheet'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  A.openCharacter = openCharacter;
  /* Change a filed character from outside its sheet (the crew sheet's bank payout): `patch.play` is merged over the
     character's stored play, and only what changed goes out through the same delta path as the sheet's own saves. */
  function updateCharacter(id, patch) {
    if (!db) return Promise.reject(new Error('Saved characters are not available in this view.'));
    var before = (openId === id && latest) || cache[id];
    if (!before) return Promise.reject(new Error('That character was not found.'));
    var full = {};
    Object.keys(patch || {}).forEach(function (k) { full[k] = k === 'play' && isObj(patch.play) ? Object.assign({}, isObj(before.play) ? clone(before.play) : {}, clone(patch.play)) : clone(patch[k]); });
    if (!Object.keys(full).some(function (k) { return !same(full[k], before[k]); })) return Promise.resolve(false);
    var after = Object.assign({}, before, full, { updatedAt: nowIso() }), delta = playDelta(before, full), ref = col().doc(id);
    cache[id] = after; if (openId === id) latest = after;
    var write = delta && typeof ref.update === 'function' ? ref.update(clone(delta)) : ref.set(clone(after));
    return write.then(function () { return true; }, function (e) { toast('Could not save ' + (before.name || 'the character') + ': ' + (e && e.message || e), true); throw e; });
  }
  A.updateCharacter = updateCharacter;

  /* ---------- the table: one shared campaign document, campaign/main (CAMPAIGN.md) ----------
     Subscribed once, as soon as the files settle, in every mode: the next-session card (schedule.js, SCHEDULE.md) at
     the top of the creator, the sheet and the table reads it too. The table page only attaches to that subscription
     while it is open; nothing is written on open. */
  var campRef = null, campUnsub = null, campLive = false, campLoaded = false, tableOn = false, tableLatest = null, tableExists = false;
  var NO_TABLE = 'The table is not available in this view.';
  function campaignMod() { var Cm = window.B68Campaign; return Cm && typeof Cm.open === 'function' ? Cm : null; }
  function schedMod() { var Sm = window.B68Schedule; return Sm && Sm.card ? Sm : null; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function deepMerge(t, s) { for (var k in s) { if (!Object.prototype.hasOwnProperty.call(s, k)) continue; var v = s[k]; if (isObj(v) && isObj(t[k])) deepMerge(t[k], v); else t[k] = v; } return t; }
  /* the schedule's PATCH, as the server applies it: objects merge, null deletes */
  function mergeNull(t, s) { Object.keys(s).forEach(function (k) { var v = s[k]; if (v === null) delete t[k]; else if (isObj(v) && isObj(t[k])) mergeNull(t[k], v); else t[k] = clone(v); }); return t; }
  /* the leaves of a schedule patch that differ from what is stored (a null for a key that is not there is dropped) */
  function prune(p, before) {
    var out = {}, any = false; before = isObj(before) ? before : {};
    Object.keys(p).forEach(function (k) {
      var v = p[k], ov = before[k];
      if (v === null) { if (ov != null) { out[k] = null; any = true; } return; }
      if (isObj(v) && isObj(ov)) { var sub = prune(v, ov); if (sub) { out[k] = sub; any = true; } return; }
      if (!same(v, ov)) { out[k] = v; any = true; }
    });
    return any ? out : null;
  }
  /* names for owners and log authors when the runtime has user.profiles: { id: name } */
  function profiles(ids) {
    if (!userCap || typeof userCap.profiles !== 'function') return Promise.resolve({});
    return Promise.resolve().then(function () { return userCap.profiles(ids); }).then(function (r) {
      var out = {};
      if (Array.isArray(r)) r.forEach(function (x) { if (x && x.id) out[x.id] = x.name || x.email || ''; });
      else if (r && typeof r === 'object') Object.keys(r).forEach(function (k) { var v = r[k]; out[k] = typeof v === 'string' ? v : v ? (v.name || v.email || '') : ''; });
      return out;
    }).catch(function () { return {}; });
  }
  /* patch: changed top-level fields of session / crew / clocks / log (crew may be partial) and the changed schedule
     and scene leaves (null deletes). Only what differs from the latest known document is sent; the first write to a missing
     document creates it whole. Used by the table page and by the next-session card (an RSVP from any mode). */
  function campaignSave(patch) {
    var ref = campRef;
    if (!ref) return Promise.reject(new Error('The table is not available here.'));
    var before = tableLatest || {}, out = {}, any = false;
    ['session', 'crew', 'clocks', 'log', 'schedule', 'scene'].forEach(function (k) {
      if (!patch || !Object.prototype.hasOwnProperty.call(patch, k)) return;
      var nv = patch[k], ov = before[k];
      if (k === 'crew' && isObj(nv)) { var sub = {}, s2 = false; for (var f in nv) if (Object.prototype.hasOwnProperty.call(nv, f) && !same(nv[f], isObj(ov) ? ov[f] : undefined)) { sub[f] = nv[f]; s2 = true; } if (s2) { out.crew = sub; any = true; } return; }
      if ((k === 'schedule' || k === 'scene') && isObj(nv)) { var sp = prune(nv, ov); if (sp) { out[k] = sp; any = true; } return; }
      if (!same(nv, ov)) { out[k] = nv; any = true; }
    });
    if (!any) return Promise.resolve(false);
    out.updatedAt = nowIso();
    var rest = {}; Object.keys(out).forEach(function (k) { if (k !== 'schedule' && k !== 'scene') rest[k] = out[k]; });
    var merged = deepMerge(clone(before), clone(rest)), Cm = campaignMod(), write;
    if (out.schedule) merged.schedule = mergeNull(isObj(merged.schedule) ? merged.schedule : {}, out.schedule);
    if (out.scene) merged.scene = mergeNull(isObj(merged.scene) ? merged.scene : {}, out.scene);
    if (!tableExists && typeof ref.set === 'function') {
      var full = Cm && Cm.normalize ? Cm.normalize(merged) : merged; full.updatedAt = out.updatedAt;
      tableExists = true; tableLatest = full; write = ref.set(clone(full));
    } else {
      tableLatest = merged;
      write = Promise.resolve().then(function () { return ref.update(clone(out)); }).catch(function (e) {
        if (/not.?found|no document|does not exist|missing/i.test(String(e && e.message || e)) && typeof ref.set === 'function') { var f2 = Cm && Cm.normalize ? Cm.normalize(merged) : merged; f2.updatedAt = out.updatedAt; return ref.set(clone(f2)); }
        throw e;
      });
    }
    return write.then(function () { return true; }, function (e) { toast('Could not save the table: ' + (e && e.message || e), true); throw e; });
  }
  function tableApi(ref) {
    return {
      save: campaignSave,
      /* the whole document (PUT on the hosted API, GM only): removing a log line, which a patch can never do */
      replace: function (whole) {
        if (campRef !== ref || !tableOn) return Promise.reject(new Error('The table is closed.'));
        var Cm = campaignMod(), full = Cm && Cm.normalize ? Cm.normalize(whole) : clone(whole); full.updatedAt = nowIso();
        tableExists = true; tableLatest = clone(full);
        return Promise.resolve().then(function () { return ref.set(clone(full)); }).then(function () { return true; }, function (e) { toast('Could not save the table: ' + (e && e.message || e), true); throw e; });
      },
      me: A.me, canWrite: A.canWrite, isGM: A.isGM === true,
      roster: function () { return roster.slice(); },
      openCharacter: function (id) { openCharacter(id); },
      updateCharacter: updateCharacter,
      playStatus: playStatus, playFacts: playFacts,
      profiles: userCap && typeof userCap.profiles === 'function' ? profiles : null
    };
  }
  /* the one campaign subscription, started when the files settle (and again by the table if it was not) */
  function startCampaign() {
    if (campRef || !db) return;
    var ref = null; try { ref = db.collection('campaign').doc('main'); } catch (e) { ref = null; }
    if (!ref) return;
    campRef = ref; tableLatest = null; tableExists = false; campLoaded = false;
    var Sm = schedMod(); if (Sm) { try { Sm.card.mount($('nextSession'), cardApi()); } catch (e) {} }
    function arrived(snap) {
      if (campRef !== ref) return;
      var data = snap && snap.exists !== false && typeof snap.data === 'function' ? snap.data() : null;
      if (!isObj(data)) data = null;
      tableExists = !!data; tableLatest = data ? clone(data) : null; campLoaded = true;
      var Cm = campaignMod();
      if (tableOn && Cm) { try { Cm.update(data ? clone(data) : null); } catch (e) { toast('The table could not render: ' + (e && e.message || e), true); } }
      var S2 = schedMod(); if (S2) { try { S2.card.update(data ? clone(data) : null); } catch (e) { if (window.console) console.error(e); } }
      renderHome();
      var Cp = castMod(); if (Cp) { try { Cp.campaign(data ? clone(data) : null); } catch (e) { if (window.console) console.error(e); } }
      var Gp = gmMod(); if (Gp && Gp.campaign) { try { Gp.campaign(data ? clone(data) : null); } catch (e) { if (window.console) console.error(e); } }
      var T2 = tracker(); if (openId && T2 && T2.refresh) { try { T2.refresh(); } catch (e) {} }   /* the open sheet reads the table's session */
    }
    function failed(e) { if (campRef !== ref) return; if (!campLoaded && !campGaveUp) { campGaveUp = true; renderHome(); } if (!tableOn) return; toast('The table is offline: ' + (e && e.message || e), true); }
    campaignArrived = arrived; campaignFailed = failed;
    if (typeof ref.onSnapshot === 'function') { try { campUnsub = ref.onSnapshot(arrived, failed); campLive = !!campUnsub; } catch (e) { campUnsub = null; campLive = false; } }
    if (!campLive) readCampaignOnce();
    setTimeout(function () { if (campRef === ref && !campLoaded && !campGaveUp) { campGaveUp = true; renderHome(); } }, 3000);   /* Home stops waiting for a slow table */
  }
  var campaignArrived = null, campaignFailed = null, campGaveUp = false;
  function readCampaignOnce() {
    var ref = campRef; if (!ref || !campaignArrived) return;
    (typeof ref.get === 'function' ? Promise.resolve().then(function () { return ref.get(); }) : Promise.resolve(null)).then(campaignArrived).catch(campaignFailed);
  }
  /* what the next-session card may do: answer for the viewer, save an .ics, name people */
  function cardApi() {
    return {
      me: function () { return A.me; }, canWrite: function () { return A.canWrite; },
      save: campaignSave, saveFile: function (name, text) { saveFile(name, text); },
      people: function () { var ids = []; roster.forEach(function (d) { if (d.owner && ids.indexOf(d.owner) < 0) ids.push(d.owner); }); return ids; },
      profiles: userCap && typeof userCap.profiles === 'function' ? profiles : null
    };
  }
  /* ---------- lazy bundles (routes.js, B68Load): a route's own scripts and stylesheets are fetched the first time it opens ----------
     lazily(name, mode, fn, what, show): true when the bundle is being fetched, after which fn() runs again if the page is
     still in `mode`; false when there is nothing to fetch (no loader, or the bundle is in and the module is still missing),
     so the starter says the module is missing as before. show(text) puts "Loading …" in the route's panel, and the reason
     there when the fetch fails (toasted too); opening the route again tries again. */
  function lazily(name, mode, fn, what, show) {
    var L = window.B68Load;
    if (!L || typeof L.need !== 'function' || !L.BUNDLES || !L.BUNDLES[name] || L.done(name)) return false;
    show('Loading ' + what + '…');
    L.need(name).then(function () { if (document.body.dataset.mode === mode) fn(); }, function (e) {
      var msg = 'Could not load ' + what + ': ' + (e && e.message || e);
      toast(msg, true);
      if (document.body.dataset.mode === mode) show(msg + '. Check the connection, then open it again.');
    });
    return true;
  }
  /* the note in a route's panel while its bundle loads: into an empty panel, or over the note itself */
  function panelNote(id) { return function (text) { var el = $(id); if (el && (!el.firstChild || el.querySelector('.b68-loading'))) el.innerHTML = '<p class="hint b68-loading" style="padding:24px 16px">' + esc(text) + '</p>'; }; }
  function startTable() {
    var Cm = campaignMod();
    if (!Cm) { if (!lazily('table', 'table', startTable, 'the table', panelNote('table-page'))) toast('The table module is missing.', true); return; }
    if (tableOn) return;
    if (!dbSettled) { Cm.notice('Opening the table…'); return; }   /* boot calls again once the files settle */
    startCampaign();
    if (!campRef) { Cm.notice(NO_TABLE, true); return; }
    tableOn = true;
    Cm.open(tableApi(campRef));
    if (campLoaded) { try { Cm.update(tableLatest ? clone(tableLatest) : null); } catch (e) { toast('The table could not render: ' + (e && e.message || e), true); } }
    if (!campLive) readCampaignOnce();   /* no live subscription: read the document afresh each time the table opens */
  }
  function closeTable() {
    tableOn = false;
    var Cm = campaignMod(); if (Cm && Cm.close) { try { Cm.close(); } catch (e) {} }
  }
  function openTable() {
    setMode('table');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  A.openTable = openTable;
  /* #t/schedule: the table, scrolled to its schedule box once it is drawn */
  function openSchedule() {
    if (document.body.dataset.mode !== 'table') setMode('table', true);
    if ((location.hash || '') !== '#t/schedule') pushHash('#t/schedule');
    var scroll = function () { whenDrawn(function () { return $('tp-schedule') || document.querySelector('#table-page .tp-schedbox'); }, function (n) { try { n.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }); };
    /* the table's bundle may still be on its way (startTable fetches it and says so): look for the box once it is here */
    var L = window.B68Load;
    if (!campaignMod() && L && typeof L.need === 'function') { L.need('table').then(function () { if (document.body.dataset.mode !== 'table') return; if (!tableOn) startTable(); scroll(); }, function () {}); return; }
    scroll();
  }
  /* run fn(node) once find() returns a node while a sheet is open (it draws when the character arrives) */
  function whenSheet(find, fn) {
    var t0 = Date.now();
    (function look() { if (document.body.dataset.mode !== 'sheet') return; var n = find(); if (n) { fn(n); return; } if (Date.now() - t0 < 4000) setTimeout(look, 100); })();
  }
  /* run fn(node) once find() returns a node while the table is open (it draws when the campaign arrives) */
  function whenDrawn(find, fn) {
    var t0 = Date.now();
    (function look() { if (document.body.dataset.mode !== 'table') return; var n = find(); if (n) { fn(n); return; } if (Date.now() - t0 < 5000) setTimeout(look, 100); })();
  }

  /* ---------- the season print (season.js): #print, every filed character and the crew in one printable document ----------
     It reads the files once (nothing is written) when they have settled; Back returns to the view it came from. */
  function seasonMod() { var Sn = window.B68Season; return Sn && typeof Sn.render === 'function' ? Sn : null; }
  function printApi() {
    return {
      ready: function () { return new Promise(function (res) { (function wait() { if (dbSettled) res(); else setTimeout(wait, 50); })(); }); },
      db: function () { return db; },
      roster: function () { return roster.slice(); },
      me: function () { return A.me; }, isGM: function () { return A.isGM === true; },
      profiles: function (ids) { return userCap && typeof userCap.profiles === 'function' ? profiles(ids) : Promise.resolve({}); },
      back: leavePrint
    };
  }
  function startPrint() {
    var Sn = seasonMod();
    if (!Sn) { if (!lazily('print', 'print', startPrint, 'the season print', panelNote('season'))) toast('The season print module is missing.', true); return; }
    try { Sn.render(printApi()); } catch (e) { toast('The season print could not render: ' + (e && e.message || e), true); }
  }
  function closePrint() { var Sn = seasonMod(); if (Sn && Sn.close) { try { Sn.close(); } catch (e) {} } }
  function openPrint() { setMode('print'); window.scrollTo(0, 0); }
  function leavePrint() { goBack(); }
  A.openPrint = openPrint;

  /* ---------- the rules wiki (rules.js): #rules, #rules?q=<words>, #rules/<book>/<slug>; the hosted build only (rules.js, RULES.md) ---------- */
  function rulesMod() { var R = window.B68Rules; return R && typeof R.open === 'function' ? R : null; }
  function rulesOn() { var R = rulesMod(); return !!(R && R.available && R.available()); }
  function isRulesHash(h) { return /^#rules($|[\/?])/.test(h); }
  function rulesApi() {
    return {
      ready: function () { return new Promise(function (res) { (function wait() { if (dbSettled) res(); else setTimeout(wait, 50); })(); }); },
      isGM: function () { return A.isGM === true; }, me: function () { return A.me; }, back: goBack
    };
  }
  function startRules() { var R = rulesMod(), el = $('rules-page'); if (!R || !el) { toast('The rules module is missing.', true); return; } try { R.open(el, rulesApi()); } catch (e) { toast('The rules could not open: ' + (e && e.message || e), true); } }
  function closeRules() { var R = rulesMod(); if (R && R.close) { try { R.close(); } catch (e) {} } }
  function rulesRoute() { var R = rulesMod(); if (R && R.route) { try { R.route(); } catch (e) {} } }
  function openRules() { setMode('rules'); window.scrollTo(0, 0); }
  A.openRules = openRules;
  /* ---------- the cast (cast-page.js, CAST.md): NPC portraits, #cast, and the "on stage" banner on every screen ----------
     The module is started once the files settle (the banner needs it in every mode) and gets each campaign snapshot,
     whose `scene` says who is on stage; the page itself is the `cast` mode. */
  var castOn = false;
  function castMod() { var Cp = window.B68CastPage; return Cp && typeof Cp.init === 'function' ? Cp : null; }
  function castApi() {
    return {
      db: function () { return db; },
      me: function () { return A.me; }, isGM: function () { return A.isGM === true; }, canWrite: function () { return A.canWrite; },
      saveScene: function (scene) { return campaignSave({ scene: scene }); },   /* { npcs: { id: true | false }, at } through the table's own save */
      back: goBack
    };
  }
  function startCast() {
    var Cp = castMod(); if (!Cp) { toast('The cast module is missing.', true); return; }
    castOn = true;
    try { Cp.open(location.hash || '#cast'); } catch (e) { toast('The cast could not render: ' + (e && e.message || e), true); }
  }
  function castRoute() { var Cp = castMod(); if (Cp && castOn) { try { Cp.route(location.hash || '#cast'); } catch (e) {} } }
  function closeCast() { castOn = false; var Cp = castMod(); if (Cp && Cp.close) { try { Cp.close(); } catch (e) {} } }

  /* ---------- the GM's page (gm-page.js, GM.md): #gm; the hosted build and the GM only (the server enforces it, 403) ----------
     It waits for the files to settle (it needs to know who the viewer is), then draws itself; a player or the claude.ai
     artifact sees a short message. Each campaign snapshot is passed on for its state rail. */
  function gmMod() { var G = window.B68GmPage; return G && typeof G.open === 'function' ? G : null; }
  function gmOn() { return A.isGM === true && !!(window.claude && window.claude.gm); }
  function settled() { return new Promise(function (res) { (function wait() { if (dbSettled) res(); else setTimeout(wait, 50); })(); }); }
  function gmPageApi() {
    return {
      ready: settled,
      isGM: function () { return A.isGM === true; }, roleKnown: function () { return A.roleKnown === true; }, me: function () { return A.me; },
      gm: function () { return (window.claude && window.claude.gm) || null; },
      db: function () { return db; },
      campaign: function () { return campLoaded && isObj(tableLatest) ? clone(tableLatest) : null; },
      saveScene: function (scene) { return campaignSave({ scene: scene }); },   /* Put on stage from the GM page: { npcs: { id: true | false }, at }, as the cast page saves it */
      saveFile: function (name, data) { saveFile(name, data); },
      copy: function (text, ok) { copyText(text, ok); }
    };
  }
  function startGm() {
    var G = gmMod(), el = $('gm-page');
    if (!G && el && lazily('gm', 'gm', startGm, 'the GM page', panelNote('gm-page'))) return;
    if (!G || !el) { toast('The GM page module is missing.', true); return; }
    try { G.open(el, gmPageApi()); } catch (e) { toast('The GM page could not open: ' + (e && e.message || e), true); }
  }
  function closeGm() { var G = gmMod(); if (G && G.close) { try { G.close(); } catch (e) {} } }
  /* a viewer KNOWN not to be the GM drops every GM pack cached in this browser (gm-page.js purge: IndexedDB `b68-gm`, the
     sticky copy in localStorage). The GM bundle is lazy, so for that alone it is fetched only when this browser holds the
     pack's database or the sticky copy (a browser that cannot list its databases fetches it to be sure). */
  function purgeGm() {
    var G = gmMod();
    var run = function () { var G2 = gmMod(); if (G2 && G2.purge) { try { G2.purge(); } catch (e) {} } };
    if (G) { run(); return; }
    var load = function () { var L = window.B68Load; if (L && typeof L.need === 'function') L.need('gm').then(run, function () {}); };
    var sticky = false; try { sticky = localStorage.getItem('b68.gm.sticky') !== null; } catch (e) {}
    if (sticky) { load(); return; }
    var idb = window.indexedDB;
    if (!idb) return;
    if (typeof idb.databases !== 'function') { load(); return; }
    Promise.resolve().then(function () { return idb.databases(); }).then(function (l) { if ((l || []).some(function (d) { return d && d.name === 'b68-gm'; })) load(); }, load);
  }
  function openGm() { setMode('gm'); window.scrollTo(0, 0); }
  A.openGm = openGm;
  /* ---------- the display (display-page.js): #display, full screen for the iPad signed in as the GM; no header or nav ---------- */
  function displayMod() { var D = window.B68DisplayPage; return D && typeof D.mount === 'function' ? D : null; }
  var displayMounted = false;
  function displayNote(el, msg) { el.innerHTML = '<div class="gm-dispnote"><p>' + esc(msg) + '</p><p><a href="#">Home</a></p></div>'; }
  function startDisplay() {
    var el = $('display-page'); if (!el) return;
    displayNote(el, 'Opening the display…');
    settled().then(function () {
      if (document.body.dataset.mode !== 'display' || displayMounted) return;
      var D = displayMod();
      if (!D) { if (!lazily('display', 'display', startDisplay, 'the display', function (t) { displayNote(el, t); })) displayNote(el, 'The display module is missing.'); return; }
      if (!(window.claude && window.claude.gm)) { displayNote(el, 'GM tools are available on the hosted app.'); return; }
      if (A.isGM !== true && A.isDisplay !== true) { displayNote(el, 'GM only: the display is for an iPad signed in as the GM or as the table display.'); return; }
      el.innerHTML = '';
      /* db: the resolved db (the files have settled here), since display-page.js calls db.collection() directly */
      try { D.mount(el, { gm: window.claude.gm, db: db, figures: window.B68Figure, cast: window.B68Cast, isGM: A.isGM === true || A.isDisplay === true }); displayMounted = true; }
      catch (e) { displayNote(el, 'The display could not open: ' + (e && e.message || e)); }
    });
  }
  function closeDisplay() {
    var D = displayMod();
    if (displayMounted && D && typeof D.unmount === 'function') { try { D.unmount(); } catch (e) {} }
    displayMounted = false;
    var el = $('display-page'); if (el) el.innerHTML = '';
  }

  /* roster: the one declared with the line-up above (a second `var roster` here reset it) */
  /* what a filed sheet says about itself: the cards' status line and the GM table both read these facts, so they never disagree */
  function itemLoadOf(pb, play, name) { var all = ((pb && pb.items) || []).concat(A.CT.STANDARD_ITEMS || [], (play.extraItems || []).map(function (x) { return [x && x.name, x && x.load]; })); var it = all.filter(function (i) { return i && i[0] === name; })[0]; return it ? +it[1] || 0 : 0; }
  function playFacts(d) {
    var p = d.play, pb = A.CT.byId[d.playbook] || {};
    var f = { fresh: !p || typeof p !== 'object', stressName: pb.stressName || (pb.hull ? 'Drain' : 'Stress'), stressMax: pb.stressMax || (pb.hull ? 10 : 9), stress: null, alluvium: null, alluviumMax: pb.alluvium ? pb.alluvium.max : 9, harmCount: 0, worstHarm: '', healing: 0, xp: null, load: null, loadLimit: null, struck: 0, stacks: 0 };
    if (f.fresh) return f;
    if (typeof p.stress === 'number') f.stress = p.stress;
    if (pb.timetraveler && typeof p.alluvium === 'number') f.alluvium = p.alluvium;
    var h = p.harm || {}; [['l4', 4], ['l3', 3], ['l2', 2], ['l1', 1]].forEach(function (k) { var v = h[k[0]]; (Array.isArray(v) ? v : [v]).forEach(function (t) { t = t == null ? '' : String(t).trim(); if (!t) return; f.harmCount++; if (!f.worstHarm) f.worstHarm = k[1] + ': ' + t; }); });
    f.healing = typeof p.healing === 'number' ? p.healing : 0;
    if (p.xp && typeof p.xp.playbook === 'number') f.xp = p.xp.playbook;
    f.stacks = typeof p.stacks === 'number' ? p.stacks : 0;
    if (!pb.ghost) { var ab = p.abilities || []; var bonus = (ab.indexOf('Walking Arsenal') >= 0 ? 2 : 0) + (ab.indexOf('Retractable Arsenal') >= 0 ? 2 : 0); f.load = (p.items || []).reduce(function (t, n) { return t + itemLoadOf(pb, p, n); }, 0) + f.stacks; f.loadLimit = (p.loadLimit === 'loud' ? 6 : 3) + bonus; }
    f.struck = (p.keys || []).filter(function (k) { return k && (k.deadlock || k.glitch); }).length;
    return f;
  }
  function playStatus(d) {
    var f = playFacts(d); if (f.fresh) return 'new sheet';
    var bits = [];
    if (f.stress != null) bits.push(f.stressName + ' ' + f.stress + '/' + f.stressMax);
    if (f.alluvium != null) bits.push('alluvium ' + f.alluvium + '/' + f.alluviumMax);
    if (f.harmCount) bits.push(f.harmCount + ' harm');
    if (f.xp != null) bits.push('xp ' + f.xp + '/8');
    if (f.stacks) bits.push(f.stacks + ' stacks');
    return bits.join(' · ') || 'fresh sheet';
  }
  A.playFacts = playFacts; A.playStatus = playStatus;
  function ago(iso) {
    var t = Date.parse(iso || ''); if (!t) return '—';
    var sec = Math.round((Date.now() - t) / 1000); if (sec < 45) return 'just now';
    var m = Math.round(sec / 60); if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    var dd = Math.round(h / 24); if (dd < 14) return dd + ' d ago';
    try { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: dd > 300 ? 'numeric' : undefined }); } catch (e) { return String(iso).slice(0, 10); }
  }
  function visibleDocs() { return filter === 'mine' && A.me ? roster.filter(function (d) { return d.owner === A.me; }) : roster; }
  function syncFilter() {
    var seg = $('rosterFilter'); if (!seg) return;
    var mine = roster.some(function (d) { return A.me && d.owner === A.me; });
    seg.hidden = !A.me;
    if (!filterChosen) filter = (A.me && mine) ? 'mine' : 'all';
    seg.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.f === filter)); });
  }
  /* cards or the GM table; the choice is remembered per browser */
  var view = 'cards'; try { if (localStorage.getItem('b68.rosterView') === 'table') view = 'table'; } catch (e) {}
  function setRosterView(v) { view = v === 'table' ? 'table' : 'cards'; try { localStorage.setItem('b68.rosterView', view); } catch (e) {} renderRoster(roster); }
  A.setRosterView = setRosterView;
  function syncView() {
    var seg = $('rosterView'); if (seg) seg.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === view)); });
    var c = $('cards'), t = $('table'); if (c) c.hidden = view === 'table'; if (t) t.hidden = view !== 'table';
  }
  function emptyHtml() { return '<div class="empty">' + (roster.length ? 'None of these are yours yet. Make a character and it is saved to your account.' : 'No characters yet. Make one with “Make a character”; it appears here once it is saved.') + '</div>'; }
  function renderTable(list, into) {
    var box = into || $('table'); if (!box) return;
    if (!list.length) { box.innerHTML = emptyHtml(); return; }
    var t = el('table', 'tbl'); t.setAttribute('aria-label', into ? 'The players' : 'The table');
    t.innerHTML = '<thead><tr><th class="nm">Name</th><th class="pbk">Playbook</th><th class="num">Stress</th><th class="hm">Worst harm</th><th class="num">Healing</th><th class="num">XP</th><th class="num">Load</th><th class="num">Struck</th><th class="num">Updated</th></tr></thead>';
    var tb = el('tbody');
    list.forEach(function (d) {
      var f = playFacts(d), tr = el('tr', A.me && d.owner === A.me ? 'mine' : null); tr.tabIndex = 0; tr.setAttribute('role', 'button'); tr.title = 'Open the sheet'; tr.dataset.id = d.id;
      function td(label, html, cls) { return '<td data-l="' + esc(label) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</td>'; }
      var dash = '<span class="dim">—</span>';
      tr.innerHTML = td('Name', '<b>' + esc(d.name || 'Unnamed') + '</b>' + (d.alias ? '<small>' + esc(d.alias) + '</small>' : ''), 'nm')
        + td('Playbook', esc(d.playbookName || pbName(d.playbook)), 'pbk')
        + td(f.stressName, f.fresh ? '<span class="dim">new sheet</span>' : '<span class="k">' + esc(f.stressName) + '</span><span class="v' + (f.stress >= f.stressMax - 1 ? ' bad' : '') + '">' + f.stress + '/' + f.stressMax + '</span>', 'num st')
        + td('Worst harm', f.worstHarm ? '<span class="' + (f.worstHarm[0] >= '3' ? 'bad' : '') + '">' + esc(f.worstHarm) + '</span>' + (f.harmCount > 1 ? ' <small class="dim">+' + (f.harmCount - 1) + '</small>' : '') : dash, 'hm')
        + td('Healing', f.fresh ? dash : f.healing + '/4', 'num')
        + td('Playbook xp', f.fresh || f.xp == null ? dash : f.xp + '/8', 'num')
        + td('Load', f.fresh || f.load == null ? dash : '<span class="' + (f.load > f.loadLimit ? 'bad' : '') + '">' + f.load + '/' + f.loadLimit + '</span>', 'num')
        + td('Struck keys', f.fresh ? dash : (f.struck ? '<span class="bad">' + f.struck + '</span>' : '0'), 'num')
        + td('Updated', '<span title="' + esc(d.updatedAt || '') + '">' + esc(ago(d.updatedAt)) + '</span>', 'num up');
      tr.onclick = function () { openCharacter(d.id); };
      tr.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openCharacter(d.id); } };
      tb.appendChild(tr);
    });
    t.appendChild(tb); box.innerHTML = ''; box.appendChild(t);
  }
  /* may this viewer change this character: the GM any, a player their own and the unowned (the server's rule) */
  function mayEdit(d) { return A.canWrite !== false && (A.isGM === true || !d.owner || d.owner === A.me); }
  function figureSvg(d, h, pre) {
    try { var s = clone(d.spec); s.id = pre + d.id; var svg = K.render(s, { height: h, lod: 'lo', shadow: false }).svg; return svg.replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1'); } catch (e) { return '?'; }
  }
  function renderCards(list) {
    var box = $('cards');
    if (!list.length) { box.innerHTML = emptyHtml(); return; }
    box.innerHTML = '';
    list.forEach(function (d) {
      var card = el('div', 'card' + (A.me && d.owner === A.me ? ' mine' : '')); card.setAttribute('role', 'button'); card.tabIndex = 0; card.title = 'Open the sheet';
      var pic = el('div', 'pic' + ((A.CT.byId[d.playbook] || {}).ghost ? ' ghostly' : '')); pic.innerHTML = figureSvg(d, 150, 'c-');
      var meta = el('div', 'meta'); meta.innerHTML = '<span class="nm">' + esc(d.name || 'Unnamed') + '</span><span class="cd">' + esc((d.playbookName || pbName(d.playbook)) + (d.code ? ' · ' + d.code : '')) + '</span><span class="st">' + esc(playStatus(d)) + '</span>';
      /* Edit figure only on the cards this viewer may change; removing a character lives on its sheet */
      if (mayEdit(d)) {
        var acts = el('div', 'acts'); var ed = el('span', 'ed', 'Edit figure'); ed.setAttribute('role', 'button'); ed.tabIndex = 0; ed.title = 'Load into the creator';
        ed.onclick = function (ev) { ev.stopPropagation(); editFigure(d); };
        ed.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); editFigure(d); } };
        acts.appendChild(ed); meta.appendChild(acts);
      }
      card.appendChild(pic); card.appendChild(meta);
      card.onclick = function () { openCharacter(d.id); };
      card.onkeydown = function (ev) { if (ev.target === card && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openCharacter(d.id); } };
      box.appendChild(card);
    });
  }
  var rosterSeen = false;   /* the first collection snapshot arrived */
  function renderRoster(docs) {
    roster = docs || []; syncFilter(); syncView(); syncBackups();
    if (tableOn) { var Cm = campaignMod(); if (Cm && Cm.rosterChanged) { try { Cm.rosterChanged(); } catch (e) {} } }
    var Sm = schedMod(); if (Sm && campRef) { try { Sm.card.refresh(); } catch (e) {} }
    var list = visibleDocs();
    if (view === 'table') renderTable(list); else renderCards(list);
    A.drawLineup(); syncNav(); renderHome();
  }
  A._renderRoster = renderRoster;
  try { Object.defineProperty(A, 'roster', { get: function () { return roster; } }); } catch (e) {}
  var rf = $('rosterFilter'); if (rf) rf.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { filter = b.dataset.f; filterChosen = true; renderRoster(roster); }; });
  var rv = $('rosterView'); if (rv) rv.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { setRosterView(b.dataset.v); }; });

  /* ---------- backups: every character the viewer can see and the table as one JSON; restore previews the file, then files
     each chosen character as a new document and, for the GM after a confirm, replaces the table ---------- */
  function hostedExport() { var rt = window.B68Runtime; return rt && rt.kind === 'cloudflare' && typeof rt.exportAll === 'function' ? rt : null; }
  function syncBackups() {
    var b = $('backups'), dl = $('dlAll'), de = $('dlEverything'), rs = $('restoreBtn'), h = $('backupHint'); if (!b) return;
    if (dl) dl.hidden = !downloads;
    if (de) de.hidden = !downloads || !hostedExport() || A.isGM !== true;
    if (rs) rs.hidden = !db || A.canWrite === false;
    b.hidden = (!dl || dl.hidden) && (!rs || rs.hidden);
    if (h) h.textContent = !dl || dl.hidden ? 'Restore adds the characters in a backup file as new copies; you check the list first.'
      : A.isGM === true ? 'A backup holds every character on file and the whole table, hidden clocks included.'
      : 'A backup holds every character you can see, yours and everyone else’s, and the table as players see it.';
  }
  /* the table as this viewer sees it: { id, doc, updatedAt, view }. A player's copy leaves out the clocks hidden from
     players (the page never shows them one). None while nothing is stored (the hosted default has no updatedAt). */
  function campaignBackup() {
    var d = campLoaded && tableExists && isObj(tableLatest) ? clone(tableLatest) : null;
    if (!d || (window.B68Runtime && window.B68Runtime.kind === 'cloudflare' && !d.updatedAt)) return null;
    var gm = A.isGM === true;
    if (!gm && Array.isArray(d.clocks)) d.clocks = d.clocks.filter(function (c) { return !(c && c.hidden); });
    return { id: 'main', doc: d, updatedAt: d.updatedAt || null, view: gm ? 'gm' : 'player' };
  }
  /* every character on file the viewer can see, whatever the Mine / Everyone filter shows */
  function downloadAll() {
    var list = roster, camp = campaignBackup(); if (!list.length && !camp) { toast('Nothing to download yet.', true); return; }
    var data = { v: 1, exportedAt: nowIso(), characters: list.map(function (d) { return clone(d); }) };
    if (camp) data.campaign = camp;
    saveFile('blades68-backup-' + data.exportedAt.slice(0, 10) + '.json', JSON.stringify(data, null, 2));
  }
  /* hosted, GM only: the server's whole export (GET /api/export through the runtime), saved as it came */
  function downloadEverything() {
    var rt = hostedExport(); if (!rt) return;
    Promise.resolve().then(function () { return rt.exportAll(); }).then(function (data) {
      if (!isObj(data) || !Array.isArray(data.characters)) throw new Error('the server sent no export');
      var cid = String((isObj(data.campaign) && data.campaign.id) || 'campaign').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'campaign';
      saveFile('blades68-' + cid + '-' + String(data.exportedAt || nowIso()).slice(0, 10) + '.json', JSON.stringify(data, null, 2));
    }).catch(function (e) { toast('Could not download everything: ' + (e && e.message || e), true); });
  }
  function validBackupDoc(c) { return !!c && typeof c === 'object' && !Array.isArray(c) && typeof c.playbook === 'string' && !!A.CT.byId[c.playbook] && !!c.sheet && typeof c.sheet === 'object' && !Array.isArray(c.sheet); }
  /* the table in a backup, or null: { doc, updatedAt, view } from Download all or /api/export (whose campaign is the
     default document, updatedAt null, when nothing was stored) */
  function backupCampaign(data) {
    var c = isObj(data.campaign) && isObj(data.campaign.doc) ? data.campaign : null;
    return c && (c.updatedAt || c.doc.updatedAt) ? c : null;
  }
  /* the GM's restore of the table: the whole document through the db (a PUT on the hosted API, GM only there too) */
  function restoreCampaign(doc) {
    var ref = campRef, Cm = campaignMod();
    if (!ref || typeof ref.set !== 'function') return Promise.reject(new Error('the table is not available here'));
    var full = Cm && Cm.normalize ? Cm.normalize(clone(doc)) : clone(doc); full.updatedAt = nowIso();
    return Promise.resolve().then(function () { return ref.set(clone(full)); }).then(function () { tableExists = true; tableLatest = clone(full); });
  }
  /* accepts Download all files ({ v: 1, exportedAt, characters: [doc], campaign? }) and the hosted /api/export file
     ({ exportedAt, campaign: { id, doc, updatedAt }, characters: [{ id, doc, updatedAt }], members }, no v) */
  function restoreDocs(data, choice) {
    if (!db) { toast('Saved characters are not available in this view.', true); return Promise.resolve(0); }
    if (!data || typeof data !== 'object' || !Array.isArray(data.characters)) { toast('That is not a Blades ’68 backup: no characters list.', true); return Promise.resolve(0); }
    var exported = data.v === undefined && isObj(data.campaign) && isObj(data.campaign.doc);
    if (data.v !== 1 && !exported) { toast('Unknown backup version ' + data.v + '. Expected 1.', true); return Promise.resolve(0); }
    var good = [], bad = 0, camp = backupCampaign(data);
    data.characters.forEach(function (c) { if (isObj(c) && isObj(c.doc) && c.playbook === undefined) c = c.doc; if (validBackupDoc(c)) good.push(c); else bad++; });
    /* the table: GM only, after a confirm; anyone else restores the characters and is told the table was left */
    var gmTable = false, tableNote = '';
    if (camp) {
      if (A.isGM !== true || A.canWrite === false) tableNote = 'only the GM can restore the table';
      else if (!campRef) tableNote = 'the table is not available here';
      else gmTable = true;
    }
    if (!good.length && !gmTable) {
      if (camp && !bad) { toast(tableNote.charAt(0).toUpperCase() + tableNote.slice(1) + '.', true); return Promise.resolve(0); }
      toast(bad ? 'Nothing restorable: ' + bad + ' invalid entr' + (bad === 1 ? 'y' : 'ies') + '.' : 'The backup is empty.', true); return Promise.resolve(0);
    }
    /* the plan: a character matching a file already here (same code and name) is skipped unless copies are asked for;
       a player restores their own and unowned characters unless they opt in to the others' (the copies become theirs) */
    var plan = good.map(function (c) {
      var name = String(c.name || c.sheet.name || 'Unnamed'), code = String(c.code || (isObj(c.spec) && c.spec.code) || '');
      var dup = roster.some(function (d) { return String(d.code || '') === code && String(d.name || '').trim().toLowerCase() === name.trim().toLowerCase(); });
      return { c: c, name: name, dup: dup, other: A.isGM !== true && !!c.owner && c.owner !== A.me };
    });
    var pick = good.length ? (choice ? Promise.resolve(choice) : restorePreview(plan, camp, gmTable, tableNote)) : Promise.resolve({});
    return pick.then(function (ch) {
      if (!ch) { toast('Restore cancelled. Nothing was changed.'); return 0; }
      var take = plan.filter(function (p) { return (!p.dup || ch.copies) && (!p.other || ch.others); });
      var dups = plan.filter(function (p) { return p.dup && !ch.copies; }).length, others = plan.filter(function (p) { return p.other && !ch.others && !(p.dup && !ch.copies); }).length;
      var withTable = false;
      if (gmTable) {
        var when = String(camp.updatedAt || camp.doc.updatedAt || '').slice(0, 10);
        withTable = window.confirm('Replace the table (crew sheet, clocks, log, session and schedule) with the copy in this file' + (when ? ' from ' + when : '') + '? What is on the table now is overwritten.' + (camp.view === 'player' ? ' A player saved this copy, so it has no hidden clocks.' : '') + (good.length ? ' Cancel restores the characters only.' : ''));
        if (!withTable) tableNote = 'the table was left as it is';
      }
      if (!good.length && !withTable) { toast('The table was left as it is.', true); return 0; }
      var T = tracker(), used = {}, n = 0, seq = Promise.resolve();
      take.forEach(function (p) {
        var c = p.c;
        seq = seq.then(function () {
          var now = nowIso(), name = p.name;
          var sheet = normaliseSheet(c.sheet, c); delete sheet.docId;
          var base = A.slug(name) + '-' + Date.now().toString(36), id = base, k = 0; while (used[id] || cache[id]) id = base + '-' + (++k).toString(36); used[id] = true;
          var play = null; if (c.play && typeof c.play === 'object' && !Array.isArray(c.play)) play = clone(c.play); else if (T && T.initialPlay) { try { play = T.initialPlay(clone(sheet), c.playbook) || {}; } catch (e) { play = {}; } } else play = {};
          var spec = c.spec && typeof c.spec === 'object' && !Array.isArray(c.spec) ? clone(c.spec) : clone(A.BASE_FIGURE); if (!spec.props) spec.props = [];
          var doc = { v: 2, name: name, alias: String(c.alias || sheet.alias || ''), code: String(c.code || spec.code || ''), playbook: c.playbook, playbookName: String(c.playbookName || pbName(c.playbook)), spec: spec, sheet: sheet, play: play, owner: A.me || null, createdAt: now, updatedAt: now };
          return col().doc(id).set(doc).then(function () { cache[id] = doc; n++; });
        });
      });
      var tableDone = false;
      if (withTable) seq = seq.then(function () { return restoreCampaign(camp.doc).then(function () { tableDone = true; }, function (e) { tableNote = 'the table could not be restored: ' + (e && e.message || e); }); });
      return seq.then(function () {
        var what = n ? 'Restored ' + n + ' character' + (n === 1 ? '' : 's') + (tableDone ? ' and the table' : '') : tableDone ? 'Restored the table' : 'Restored nothing';
        toast(what + (dups ? ' · skipped ' + dups + ' already on file' : '') + (others ? ' · skipped ' + others + ' of other players' : '') + (bad ? ' · skipped ' + bad + ' invalid' : '') + (tableNote ? ' · ' + tableNote : '') + '.', !tableDone && withTable);
        return n;
      })
        .catch(function (e) { toast('Restore stopped after ' + n + ': ' + (e && e.message || e), true); return n; });
    });
  }
  A.restoreDocs = restoreDocs;
  /* the preview before anything is written: each character and what happens to it, the two opt-ins, Restore / Cancel.
     Resolves { copies, others } or null (cancelled). */
  function restorePreview(plan, camp, gmTable, tableNote) {
    var dlg = $('restoreDlg');
    if (!dlg) return Promise.resolve(window.confirm('Restore ' + plan.length + ' character' + (plan.length === 1 ? '' : 's') + ' from this file?') ? { copies: false, others: false } : null);
    var nDup = plan.filter(function (p) { return p.dup; }).length, nOther = plan.filter(function (p) { return p.other; }).length;
    return new Promise(function (resolve) {
      dlg.innerHTML = '<form method="dialog"><div class="hm-band">Restore from a backup</div><h2 id="restoreTitle">What this file adds</h2>' +
        '<ul>' + plan.map(function (p, i) { return '<li data-i="' + i + '"><b>' + esc(p.name) + '</b><small></small></li>'; }).join('') + '</ul>' +
        (nDup ? '<label class="opt"><input type="checkbox" data-o="copies"> <span>Also add copies of the ' + (nDup === 1 ? 'one' : nDup) + ' already on file</span></label>' : '') +
        (nOther ? '<label class="opt"><input type="checkbox" data-o="others"> <span>Also restore ' + (nOther === 1 ? 'the one' : 'the ' + nOther) + ' belonging to other players (the copies become yours)</span></label>' : '') +
        (camp ? '<p class="hint">' + (gmTable ? 'This file also holds the table. You are asked before it replaces the one here.' : 'This file also holds the table: ' + esc(tableNote) + '.') + '</p>' : '') +
        '<p class="sum" id="restoreSum" aria-live="polite"></p>' +
        '<div class="hm-acts"><button class="btn primary" type="button" data-o="go">Restore</button><button class="btn" type="button" data-o="cancel">Cancel</button></div></form>';
      function opts() { var o = { copies: false, others: false }; dlg.querySelectorAll('input[data-o]').forEach(function (i) { o[i.dataset.o] = i.checked; }); return o; }
      function sync() {
        var o = opts(), n = 0;
        plan.forEach(function (p, i) {
          var skip = (p.dup && !o.copies) || (p.other && !o.others), li = dlg.querySelector('li[data-i="' + i + '"]'); if (!skip) n++;
          var bits = [p.c.playbookName || pbName(p.c.playbook)]; if (p.dup) bits.push('already on file'); if (p.other) bits.push('another player’s');
          li.classList.toggle('skip', skip); li.querySelector('small').textContent = bits.join(' · ') + ' · ' + (skip ? 'skipped' : 'added as a new copy');
        });
        $('restoreSum').textContent = n ? 'Adds ' + n + ' character' + (n === 1 ? '' : 's') + ' as new copies owned by you. Nothing here is overwritten.' : 'Nothing new to add.' + (gmTable ? ' Restore asks about the table.' : '');
        var go = dlg.querySelector('[data-o="go"]'); go.disabled = !n && !gmTable; go.textContent = n ? 'Restore ' + n : gmTable ? 'Restore the table' : 'Restore';
      }
      var settled = false;
      function done(v) { if (settled) return; settled = true; dlg.onclick = dlg.onchange = dlg.oncancel = null; try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); } resolve(v); }
      dlg.onchange = sync;
      dlg.onclick = function (ev) { var b = ev.target.closest && ev.target.closest('button[data-o]'); if (!b) return; done(b.dataset.o === 'go' ? opts() : null); };
      dlg.oncancel = function (ev) { ev.preventDefault(); done(null); };
      sync();
      try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
      var first = dlg.querySelector('[data-o="go"]:not([disabled])') || dlg.querySelector('[data-o="cancel"]'); if (first) { try { first.focus(); } catch (e) {} }
    });
  }
  function restoreFromFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onerror = function () { toast('Could not read ' + (file.name || 'the file') + '.', true); };
    rd.onload = function () { var data; try { data = JSON.parse(String(rd.result)); } catch (e) { toast('That file is not JSON.', true); return; } restoreDocs(data); };
    rd.readAsText(file);
  }
  var rfi = $('restoreFile'); if (rfi) rfi.addEventListener('change', function () { var f = rfi.files && rfi.files[0]; try { restoreFromFile(f); } finally { rfi.value = ''; } });

  function docFields() {
    var p = A.pbOf() || {};
    if (A.wearingText) S.sheet.wearing = A.wearingText();
    var sheet = clone(S.sheet); delete sheet.docId;
    return { v: 2, name: S.sheet.name, alias: S.sheet.alias || '', code: S.spec.code || '', playbook: S.sheet.playbook || null, playbookName: p.name ? pbName(p.id) : '', spec: clone(S.spec), sheet: sheet, updatedAt: nowIso() };
  }
  function fileCharacter() {
    if (!db) { toast('Saving is not available in this view.', true); return; }
    if (!S.sheet.name) { toast('Give the character a name first (Identity step).', true); showStep(14); return; }
    var fields = docFields(), id = S.sheet.docId;
    function create() {
      id = A.slug(S.sheet.name) + '-' + Date.now().toString(36);
      var play = {}; var T = tracker(); if (T && T.initialPlay) { try { play = T.initialPlay(clone(S.sheet), S.sheet.playbook) || {}; } catch (e) { play = {}; } }
      var doc = Object.assign(fields, { play: play, owner: A.me || null, createdAt: fields.updatedAt });
      return col().doc(id).set(doc).then(function () { cache[id] = doc; S.sheet.docId = id; S.dirty = false; clearDraft(); A.changed(); toast('Saved ' + S.sheet.name + '. Opening the sheet.'); openCharacter(id); });
    }
    var done;
    if (id) {
      var ref = col().doc(id);
      var p = typeof ref.get === 'function' ? ref.get().then(function (snap) { return snap && snap.exists !== false && typeof snap.data === 'function' ? snap.data() : null; }) : Promise.resolve(cache[id] || null);
      done = p.then(function (cur) {
        if (!cur) return create();
        var doc = Object.assign({}, cur, fields, { play: cur.play || {}, owner: cur.owner === undefined ? (A.me || null) : cur.owner, createdAt: cur.createdAt || fields.updatedAt });
        return ref.set(doc).then(function () { cache[id] = doc; if (openId === id) latest = doc; S.dirty = false; clearDraft(); A.changed(); toast('Updated ' + S.sheet.name + '.'); openCharacter(id); });
      });
    } else done = create();
    done.catch(function (e) { toast('Could not save: ' + (e && e.message || e), true); });
  }
  A.fileCharacter = fileCharacter;
  /* returns false when the person chose to keep what the creator holds */
  function newCharacter() {
    var dr = draftInfo();
    if ((S.dirty || dr) && !window.confirm(dr && !S.sheet.docId ? 'Start a new character? Your draft (' + dr + ') is cleared. Cancel continues the draft.' : 'Start a new character? The one in the creator is cleared' + (S.sheet.docId ? ' (the saved copy stays in your characters)' : '') + '.')) return false;
    blankCreator(); window.scrollTo({ top: 0, behavior: 'smooth' }); toast('A blank form.');
    return true;
  }
  function blankCreator() {
    S.spec = clone(A.BASE_FIGURE); S.sheet = A.blankSheet(); S.dirty = false; S.view = 'figure'; clearDraft();
    A.changed(); showStep(0); A.draw(); syncEditBar();
  }
  A.newCharacter = newCharacter;

  /* ---------- exports ---------- */
  var downloads = null;
  function fileBase() { return A.slug(S.sheet.name || S.spec.id || 'subject'); }
  A.saveFile = function (name, data) { saveFile(name, data); };
  function saveFile(name, data) { if (!downloads) { toast('Saving files is not available in this view. Copy the sheet instead.', true); return; } downloads.save({ filename: name, data: data }).then(function () { toast('Saved ' + name); }).catch(function (e) { if (e && e.code === 'declined') return; toast('Could not save: ' + (e && e.message || e), true); }); }
  function copyText(txt, ok) { var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(txt) : Promise.reject(); p.then(function () { toast(ok); }).catch(function () { var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:160px;z-index:9;font:12px var(--font-mono)'; document.body.appendChild(ta); ta.focus(); ta.select(); toast('Copy blocked here. The text is selected; copy it, then click away.', true); ta.onblur = function () { ta.remove(); }; }); }
  function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64url(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('button, a#homeLink'); if (!b) return;
    switch (b.id) {
      case 'fileRoster': fileCharacter(); break;
      case 'openSheet': if (S.sheet.docId) openCharacter(S.sheet.docId); break;
      case 'newChar': newCharacter(); break;
      case 'homeLink': ev.preventDefault(); goHome(false); break;
      case 'homeBtn': goHome(false); break;
      case 'tableBtn': openTable(); break;
      case 'rulesBtn': openRules(); break;
      case 'gmBtn': openGm(); break;
      case 'mineBtn': (function () { var one = mineOnly(); if (one) openCharacter(one.id); })(); break;
      case 'editUpdate': fileCharacter(); break;
      case 'editBack': if (S.sheet.docId) openCharacter(S.sheet.docId); break;
      case 'dlAll': downloadAll(); break;
      case 'dlEverything': downloadEverything(); break;
      case 'restoreBtn': pickRestore(); break;
      case 'dlSvg': saveFile(fileBase() + '.svg', A.figureSvg(900)); break;
      case 'dlMug': saveFile(fileBase() + '-mugshot.svg', A.mugshot().svg); break;
      case 'dlPng': (function () { var svg = S.view === 'mug' ? A.mugshot().svg : A.figureSvg(900); var m = svg.match(/viewBox="([^"]+)"/); var vb = m ? m[1].split(/\s+/).map(parseFloat) : [0, 0, 540, 900]; var H = 1600, W = Math.round(H * vb[2] / vb[3]); var img = new Image(); var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); img.onload = function () { try { var c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d'); g.fillStyle = '#e8e2d4'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H); c.toBlob(function (bl) { URL.revokeObjectURL(url); if (bl) saveFile(fileBase() + (S.view === 'mug' ? '-mugshot' : '') + '.png', bl); else toast('Could not rasterise the figure.', true); }, 'image/png'); } catch (e) { toast('Could not rasterise: ' + e.message, true); } }; img.onerror = function () { URL.revokeObjectURL(url); toast('Could not rasterise the figure.', true); }; img.src = url; })(); break;
      case 'copySheet': copyText(A.sheetMarkdown(), 'Sheet copied as Markdown.'); break;
      case 'copySpec': copyText(JSON.stringify(S.spec, null, 2), 'Figure spec copied as JSON.'); break;
      case 'copyLink': copyText(location.href.split('#')[0] + '#s' + b64url(JSON.stringify({ spec: S.spec, sheet: Object.assign({}, S.sheet, { docId: undefined }) })), 'Link copied. It carries the whole character.'); break;
    }
  });
  function pickRestore() { var i = $('restoreFile'); if (!db) { toast('Saved characters are not available in this view.', true); return; } if (i) i.click(); }

  /* ---------- home: the start page, drawn from the data (the viewer's role, the table, their characters, a draft) ---------- */
  var DRAFT = 'b68.draft', draftT = null;
  function hosted() { var rt = window.B68Runtime; return !!(rt && rt.kind === 'cloudflare'); }
  /* the creator's unfiled character, as "Veteran, step 9 of 16" ('' when there is none) */
  function draftInfo() { var p = S.sheet && !S.sheet.docId && A.pbOf ? A.pbOf() : null; return p ? pbName(p.id) + ', step ' + (S.step + 1) + ' of ' + N : ''; }
  function homeReady() { return dbSettled && (!db || rosterSeen) && (!campRef || campLoaded || campGaveUp); }
  function dayOf(iso) { var Sm = schedMod(); if (Sm && Sm.fmtDay) { try { return Sm.fmtDay(iso); } catch (e) {} } try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) { return String(iso).slice(0, 10); } }
  function btn(act, label, cls, id) { return '<button type="button" class="' + (cls || 'btn') + '" data-hm="' + act + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + label + '</button>'; }
  function link(act, label) { return btn(act, label, 'hm-link'); }
  function head(kick, title, sub, lead) { return '<div class="hm-head"><p class="hm-kick">' + kick + '</p><h1 class="hm-title" id="homeTitle" tabindex="-1">' + title + '</h1>' + (sub ? '<p class="hm-sub">' + sub + '</p>' : '') + (lead ? '<p class="hm-lead">' + lead + '</p>' : '') + '</div>'; }
  function nudges(list) { return list.length ? '<ul class="hm-nudges">' + list.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul>' : ''; }
  function draftHtml() { var dr = draftInfo(); return dr ? '<div class="hm-draft"><b>Continue your draft</b><span>' + esc(dr) + '</span>' + btn('create', 'Continue', 'btn sm primary') + link('discard', 'Discard') + '</div>' : ''; }
  /* what the table says: { started, crew, session, s (the schedule), next, open (dates still to come) } */
  function tableFacts() {
    var Sm = schedMod(), d = isObj(tableLatest) ? tableLatest : {};
    var f = { started: campLoaded && tableExists && !!tableLatest && !(hosted() && !tableLatest.updatedAt), crew: isObj(d.crew) ? d.crew : {}, session: isObj(d.session) ? d.session : {}, s: null, next: null, open: [] };
    if (Sm && Sm.normalize) { try { f.s = Sm.normalize(d.schedule); f.next = Sm.upcoming(f.s); f.open = Sm.openOptions(f.s); } catch (e) { f.s = null; } }
    return f;
  }
  function sessionLine(f) {
    var n = +f.session.number || 0, out = !n ? 'No session played yet' : 'Session ' + n + (f.session.endedAt ? ' · ended ' + dayOf(f.session.endedAt) : f.session.startedAt ? ' · in play' : '');
    var Sm = schedMod(); if (f.next && Sm && Sm.fmtWhen) { try { out += ' · next ' + Sm.fmtWhen(f.next.at); } catch (e) {} }
    return esc(out);
  }
  function myOpenDates(f) { if (!f.s || !A.me) return 0; var a = f.s.avail[A.me] || {}; return f.open.filter(function (o) { return !a[o.id]; }).length; }
  function datesNudge(f) { var n = myOpenDates(f); return n ? '<span>' + (n === 1 ? 'One date needs' : n + ' dates need') + ' your answer.</span>' + btn('schedule', 'Mark your dates', 'btn sm') : ''; }
  /* A. the GM, before the table exists: four numbered steps that tick themselves off */
  function homeSetup(f) {
    var url = hosted() ? location.origin + location.pathname : location.href.split('#')[0];
    var steps = [
      [!!f.crew.name, 'Start the table', 'Name the crew and choose the crew playbook.', btn('table-setup', 'Open the table', 'btn primary')],
      [roster.some(function (d) { return d.owner && d.owner !== A.me; }), 'Invite the players', hosted() ? 'Players sign in here with Google or an emailed code. Their email must be on the sign-in list first (SETUP.md, step 5).' : 'Share this page with your players; each one opens it signed in.', btn('copylink', 'Copy the link') + '<p class="hint mono">' + esc(url) + '</p>'],
      [false, 'Moving from another copy?', 'Restore the characters and the table from a backup file.', db && A.canWrite !== false ? btn('restore', 'Restore from a backup…') : '<p class="hint">Restoring is not available in this view.</p>']
    ];
    return head('Blades ’68 · you’re the GM', 'Set up the table', '', 'One table lives at this address. Set it up once; your players sign in here and join it.') + draftHtml() +
      '<ol class="hm-steps">' + steps.map(function (s, i) { return '<li class="hm-step' + (s[0] ? ' done' : '') + '"><span class="hm-n" aria-hidden="true">' + (i + 1) + '</span>' + (s[0] ? '<span class="hm-done">Done</span>' : '') + '<h3>' + (s[0] ? '<span class="sr">Done: </span>' : '') + s[1] + '</h3><p>' + s[2] + '</p>' + s[3] + '</li>'; }).join('') + '</ol>' +
      '<div class="hm-links">' + link('cast', 'The cast') + link('new', 'Make a character') + '</div>' +
      '<p class="hm-note">This site holds one table. A second campaign needs a second copy of the app (SETUP.md).</p>';
  }
  /* B. the GM, table started: the crew, the session, what needs doing, the players at a glance */
  function homeGm(f) {
    var Sm = schedMod(), list = [];
    if (f.next && f.s && Sm) {
      var ids = []; roster.forEach(function (d) { if (d.owner && ids.indexOf(d.owner) < 0) ids.push(d.owner); });
      Sm.people(f.s, ids).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
      var waiting = ids.filter(function (id) { return id !== A.me && !Sm.rsvpOf(f.s, id); }).length;
      if (waiting) list.push('<span>' + (waiting === 1 ? 'One player hasn’t' : waiting + ' players haven’t') + ' answered for ' + esc(dayOf(f.next.at)) + '.</span>' + btn('schedule', 'See the schedule', 'btn sm'));
    }
    if (!roster.length) list.push('<span>No characters yet.</span>' + btn('copylink', 'Copy the link for the players', 'btn sm'));
    return head('The table · you’re the GM', esc(f.crew.name || 'An unnamed crew'), sessionLine(f), '') +
      '<div class="hm-acts">' + btn('table', 'Open the table', 'btn primary') + '</div>' + nudges(list) + draftHtml() +
      (roster.length ? '<section class="hm-box" aria-label="The players"><div class="hm-band">The players</div><div id="homePlayers"></div></section>' : '') +
      '<div class="hm-links">' + link('cast', 'The cast') + link('print', 'Print the season') + link('backups', 'Backups') + link('new', 'Make a character') + '</div>';
  }
  /* C. a player with no character yet */
  function homeWelcome(f) {
    var kick = esc(f.crew.name || 'Blades ’68');
    if (!db) return head(kick, 'Welcome', '', 'Saving is not available in this view, so nothing you make can be kept here. You can still make a character and save the figure.') + draftHtml() + '<div class="hm-acts">' + btn('new', 'Make a character', 'btn primary') + '</div>';
    var ro = A.canWrite === false, n = myOpenDates(f);
    return head(kick, 'Welcome to the table', '', f.open.length ? 'Make your character, then mark the dates you can play.' : 'Make your character to join the table.') + draftHtml() +
      '<div class="hm-big"><h2>Make your character</h2><p>Sixteen steps: pick a playbook, dress the figure, fill in the sheet. Saving it opens your sheet.</p>' + btn('new', 'Make your character', 'btn primary') + '</div>' +
      (n ? '<div class="hm-big"><h2>Mark your dates</h2><p>' + (n === 1 ? 'One date needs' : n + ' dates need') + ' your answer.</p>' + btn('schedule', 'Mark your dates') + '</div>' : '') +
      (ro ? '<p class="hm-note">You can look around but not change anything.</p>' : '') +
      '<div class="hm-links">' + link('table', 'See the table') + link('cast', 'The cast') + (ro ? '' : link('restore', 'Restore your characters from a backup')) + '</div>';
  }
  /* D. a player with characters: one big card each */
  function homeBack(f, mine) {
    var list = [], dn = datesNudge(f), sn = +f.session.number || 0;
    if (dn) list.push(dn);
    if (sn && f.session.startedAt && !f.session.endedAt) mine.forEach(function (d) { var ps = isObj(d.play) ? +d.play.session || 0 : 0; if (ps < sn) list.push('<span>Session ' + sn + ' has started at the table' + (mine.length > 1 ? ' (' + esc(d.name || 'Unnamed') + ')' : '') + '.</span>' + btn('join', 'Join session ' + sn, 'btn sm', d.id)); });
    var one = mine.length === 1;
    return head(esc(f.crew.name || 'Blades ’68'), 'Welcome back' + (A.myName ? ', ' + esc(A.myName) : ''), '', '') +
      '<div class="hm-chars">' + mine.map(function (d) {
        return '<article class="hm-char"><div class="pic' + ((A.CT.byId[d.playbook] || {}).ghost ? ' ghostly' : '') + '" data-fig="' + esc(d.id) + '"></div><div class="meta"><h2 class="nm">' + esc(d.name || 'Unnamed') + '</h2><span class="cd">' + esc((d.playbookName || pbName(d.playbook)) + (d.code ? ' · ' + d.code : '')) + '</span><span class="st">' + esc(playStatus(d)) + '</span>' + btn('open', 'Open sheet', one ? 'btn primary' : 'btn', d.id) + '</div></article>';
      }).join('') + '</div>' + nudges(list) + draftHtml() +
      '<div class="hm-links">' + link('table', 'The table') + link('cast', 'The cast') + link('new', 'Make another character') + link('files', 'Everyone’s characters') + link('print', 'Print the season') + link('backups', 'Backups') + '</div>';
  }
  function renderHome() {
    if (document.body.dataset.mode !== 'home') return;
    var box = $('homeMain'), files = $('files'); if (!box) return;
    var ready = homeReady();
    if (files) files.hidden = !ready || !db;
    if (!ready) { box.innerHTML = '<p class="hm-wait" role="status">Opening your sheets…</p>'; return; }
    var act = document.activeElement, keep = act && box.contains(act) ? (act.id === 'homeTitle' ? '#homeTitle' : act.id === 'homeNameIn' ? '#homeNameIn' : act.getAttribute('data-hm') ? '[data-hm="' + act.getAttribute('data-hm') + '"]' + (act.dataset.id ? '[data-id="' + act.dataset.id + '"]' : '') : null) : null;
    var f = tableFacts(), mine = A.me ? roster.filter(function (d) { return d.owner === A.me; }) : [];
    box.innerHTML = A.isGM === true && db ? (f.started ? homeGm(f) : homeSetup(f)) : mine.length ? homeBack(f, mine) : homeWelcome(f);
    var nh = nameHtml(); if (nh) { var hd = box.querySelector('.hm-head'); if (hd) hd.insertAdjacentHTML('afterend', nh); }
    if (rulesOn()) box.insertAdjacentHTML('beforeend', '<div class="hm-links">' + link('rules', 'Search the rules') + '</div>');
    box.querySelectorAll('[data-fig]').forEach(function (n) { var d = roster.filter(function (x) { return x.id === n.getAttribute('data-fig'); })[0]; if (d) n.innerHTML = figureSvg(d, 140, 'h-'); });
    var hp = $('homePlayers'); if (hp) renderTable(roster, hp);
    if (keep) { var k = box.querySelector(keep); if (k) { try { k.focus({ preventScroll: true }); } catch (e) {} } }
  }
  function homeAct(a, id) {
    if (a === 'table') openTable();
    else if (a === 'table-setup') { openTable(); whenDrawn(function () { return document.querySelector('#table-page [data-path="crew.name"]'); }, function (n) { try { n.focus(); } catch (e) {} }); }
    else if (a === 'schedule') openSchedule();
    else if (a === 'new') { setMode('create'); newCharacter(); window.scrollTo(0, 0); }
    else if (a === 'create') { setMode('create'); window.scrollTo(0, 0); }
    else if (a === 'discard') { if (window.confirm('Discard your draft (' + draftInfo() + ')? It cannot be brought back.')) { blankCreator(); renderHome(); toast('Draft discarded.'); } }
    else if (a === 'open' && id) openCharacter(id);
    else if (a === 'join' && id) { openCharacter(id); whenSheet(function () { return document.querySelector('#dossier [data-act="sessjoin"]'); }, function (n) { try { n.scrollIntoView({ behavior: 'smooth', block: 'center' }); n.focus({ preventScroll: true }); } catch (e) {} }); }   /* the sheet opens at its Join bar */
    else if (a === 'print') openPrint();
    else if (a === 'rules') openRules();
    else if (a === 'cast') { try { location.hash = '#cast'; } catch (e) {} }
    else if (a === 'files' || a === 'backups') { if (a === 'files' && filter !== 'all') { filter = 'all'; filterChosen = true; renderRoster(roster); } var n = $(a); if (n) { try { n.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} } }   /* "Everyone’s characters" shows everyone's */
    else if (a === 'restore') pickRestore();
    else if (a === 'copylink') copyText(hosted() ? location.origin + location.pathname : location.href.split('#')[0], 'Link copied. Send it to your players.');
  }
  /* ---------- the display name (name-edit.js; hosted build only): "Change name" under the greeting ---------- */
  var nameSt = { open: false, busy: false, error: '', value: null };
  function nameMod() { var N = window.B68NameEdit; return N && hosted() && A.me && N.available(window) ? N : null; }
  function nameHtml() { var N = nameMod(); return N ? N.html(nameSt, A.myName) : ''; }
  function nameFocus(sel) { var n = document.querySelector('#home ' + sel); if (n) { try { n.focus(); if (n.select && sel === '#homeNameIn') n.select(); } catch (e) {} } }
  function nameAct(a) {
    var N = nameMod(); if (!N) return;
    if (a === 'open') { nameSt = { open: true, busy: false, error: '', value: null }; renderHome(); nameFocus('#homeNameIn'); return; }
    if (a === 'cancel') { nameSt = { open: false, busy: false, error: '', value: null }; renderHome(); nameFocus('[data-nm="open"]'); return; }
    if (a !== 'save' && a !== 'clear') return;
    if (nameSt.busy) return;
    var inp = document.getElementById('homeNameIn'), val = a === 'clear' ? '' : (inp ? inp.value : nameSt.value || '');
    nameSt.busy = true; nameSt.error = ''; nameSt.value = a === 'clear' ? '' : val; renderHome();
    N.save(window.claude.profile, val).then(function (r) {
      nameSt.busy = false;
      if (r.ok) {
        A.myName = r.name || ''; nameSt = { open: false, busy: false, error: '', value: null };
        whoami(); renderHome(); nameFocus('[data-nm="open"]');
        toast(r.cleared ? 'Back to your sign-in name: ' + A.myName + '.' : 'Name changed to ' + A.myName + '.');
      } else { nameSt.error = r.message; renderHome(); nameFocus('#homeNameIn'); }
    });
  }
  var hmEl = $('home'); if (hmEl) hmEl.addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('[data-hm]'); if (b) homeAct(b.getAttribute('data-hm'), b.getAttribute('data-id')); });
  if (hmEl) {
    hmEl.addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('[data-nm]'); if (b && b.getAttribute('data-nm') !== 'save') nameAct(b.getAttribute('data-nm')); });
    hmEl.addEventListener('submit', function (ev) { var f = ev.target; if (f && f.getAttribute && f.getAttribute('data-nm-form')) { ev.preventDefault(); nameAct('save'); } });
    hmEl.addEventListener('input', function (ev) { if (ev.target && ev.target.id === 'homeNameIn') nameSt.value = ev.target.value; });
    hmEl.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && ev.target && ev.target.id === 'homeNameIn') { ev.preventDefault(); nameAct('cancel'); } });
  }

  /* ---------- boot ---------- */
  /* the creator's state: the artifact keeps it in claude.hot; elsewhere an unfiled draft goes to localStorage (b68.draft) */
  A.snapshot = function () {
    if (hot && hot.snapshot) { try { hot.snapshot(function () { return { spec: S.spec, sheet: S.sheet, step: S.step, view: S.view, dirty: S.dirty, mode: document.body.dataset.mode || 'home', open: openId }; }); } catch (e) {} return; }
    if (draftT) clearTimeout(draftT); draftT = setTimeout(writeDraft, 400);
  };
  function writeDraft() {
    draftT = null; if (hot && hot.snapshot) return;
    try { if (draftInfo()) localStorage.setItem(DRAFT, JSON.stringify({ v: 1, spec: S.spec, sheet: S.sheet, step: S.step, dirty: S.dirty, at: nowIso() })); else localStorage.removeItem(DRAFT); } catch (e) {}
  }
  function readDraft() { try { var d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); return d && isObj(d.spec) && isObj(d.sheet) && d.sheet.playbook ? d : null; } catch (e) { return null; } }
  function clearDraft() { if (draftT) { clearTimeout(draftT); draftT = null; } try { localStorage.removeItem(DRAFT); } catch (e) {} }
  function whoami() {
    var w = $('whoami'); if (!w) return;
    var rt = window.B68Runtime, isHosted = hosted();
    if (isHosted && !whoami.listening && typeof window.addEventListener === 'function') { whoami.listening = true; window.addEventListener('b68:runtime', function () { whoami(); }); }
    if (A.me) {
      var who = isHosted && rt.me ? (rt.me.name || rt.me.email || '') : '';
      w.textContent = who ? 'Signed in as ' + who + (rt.me.role === 'gm' ? ' · GM' : '') + ' · ' : 'Signed in · saved to your account';
      if (who) { var out = document.createElement('a'); out.href = '/cdn-cgi/access/logout'; out.textContent = 'Sign out'; out.className = 'signout'; w.appendChild(out); }
      /* hosted: the runtime's sync state (runtime/cf.js: B68Runtime.status, the b68:runtime event), as a chip */
      var st = isHosted && rt.status, n = st ? st.pending || 0 : 0, ch = n === 1 ? ' change' : ' changes';
      var sync = !st ? '' : !st.online ? 'Offline' + (n ? ' · ' + n + ch + ' waiting' : '') : n ? 'Saving ' + n + ch + '…' : '';
      if (sync) { var sy = document.createElement('span'); sy.className = 'sync' + (st.online ? '' : ' off'); sy.setAttribute('role', 'status'); sy.textContent = sync; w.appendChild(sy); }
      /* the server runs a newer build than this page (routes.js B68_BUILD against the API's X-B68-Build): a reload gets it */
      if (st && st.newBuild) { var up = document.createElement('a'); up.className = 'sync'; up.href = location.href; up.style.textDecoration = 'none'; up.textContent = 'Updated: reload'; up.title = 'A newer version of the app is on the server (' + st.newBuild + '). Reload to get it.'; up.onclick = function (ev) { ev.preventDefault(); location.reload(); }; w.appendChild(up); }
      w.classList.remove('off');
    }
    else if (isHosted) {
      /* a plain reload cannot fix a sign-in Access has kept but the server will not accept, so Sign in clears Access's cookie
         first and comes back here, which makes Access ask again from scratch; the server's reason is shown beside it */
      var why = rt && rt.signedOutWhy ? rt.signedOutWhy : '';
      w.textContent = 'Not signed in' + (why ? ' (' + why + ')' : '') + ' · ';
      var inl = document.createElement('a'); inl.href = '/cdn-cgi/access/logout?returnTo=' + encodeURIComponent(location.origin + '/'); inl.textContent = 'Sign in'; inl.className = 'signout'; w.appendChild(inl); w.classList.add('off');
    }
    else { w.textContent = db ? 'Not signed in · characters are not marked as yours' : 'Not signed in · saving unavailable'; w.classList.add('off'); }
  }
  function hashOpen() { var h = location.hash || ''; return h.indexOf('#c/') === 0 ? decodeURIComponent(h.slice(3)) : null; }
  /* the routes: (none) Home · #new a blank creator (asks first when there is a draft) · #create the creator as it is ·
     #s<base64url> a shared character in the creator · #c/<id> a sheet · #t the table · #t/schedule its schedule · #print · #cast the NPCs, #cast/<id> one, #cast/<id>/edit and #cast/new the GM's editor ·
     #gm the GM's page · #display the iPad's full-screen display */
  function route() {
    var h = location.hash || '', id = hashOpen(), m = document.body.dataset.mode;
    if (h === '#t' || h === '#t/schedule') { if (m !== 'table') setMode('table', true); if (h === '#t/schedule') openSchedule(); }
    else if (h === '#print') { if (m !== 'print') setMode('print', true); }
    else if (isRulesHash(h)) { if (m !== 'rules') setMode('rules', true); else rulesRoute(); }
    else if (h === '#cast' || h.indexOf('#cast/') === 0) { if (m !== 'cast') setMode('cast', true); else castRoute(); }
    else if (h === '#gm') { if (m !== 'gm') setMode('gm', true); }
    else if (h === '#display') { if (m !== 'display') setMode('display', true); }
    else if (id) { if (id !== openId || m !== 'sheet') openCharacter(id); }
    else if (h === '#new') { setMode('create', true); newCharacter(); replaceHash('#create'); syncTitle(); }
    else if (h === '#create' || isShare(h)) { if (m !== 'create') setMode('create', true); }
    else if (m !== 'home') setMode('home', true);
  }
  window.addEventListener('hashchange', function () {
    var st = history.state;
    if (st && typeof st.b68 === 'number') depth = st.b68; else { depth++; stamp(); }   /* a new entry (a link, a typed hash, pushHash) */
    route();
  });
  /* the GM: user.canEdit() when it answers a boolean, else user.isOwner(), else not */
  function gmOf(u) {
    function ask(fn) { return typeof fn === 'function' ? Promise.resolve().then(function () { return fn.call(u); }).catch(function () { return undefined; }) : Promise.resolve(undefined); }
    return ask(u.canEdit).then(function (v) { return typeof v === 'boolean' ? v : ask(u.isOwner).then(function (w) { return w === true; }); });
  }
  /* a sheet named by the hash cannot open: say so and go Home */
  function cannotOpen(msg) { if (!pendingOpen) return; pendingOpen = null; if (msg) toast(msg, true); if (document.body.dataset.mode === 'sheet' && !openId) goHome(true); }
  function boot(saved) {
    var hs = history.state; if (hs && typeof hs.b68 === 'number') depth = hs.b68; else stamp();
    var fromHash = null, h = location.hash || '';
    try { if (isShare(h)) fromHash = JSON.parse(unb64url(h.slice(2))); } catch (e) { fromHash = null; }
    var draft = hot && hot.snapshot ? null : readDraft();
    if (saved && saved.spec && saved.sheet) { S.spec = saved.spec; S.sheet = normaliseSheet(saved.sheet); S.step = saved.step || 0; S.view = saved.view || 'figure'; S.dirty = !!saved.dirty; }
    else if (fromHash && fromHash.spec) { S.spec = fromHash.spec; S.sheet = normaliseSheet(fromHash.sheet); S.dirty = true; S.step = 15; }
    else if (draft) { S.spec = draft.spec; S.sheet = normaliseSheet(draft.sheet); delete S.sheet.docId; S.step = Math.max(0, Math.min(N - 1, +draft.step || 0)); S.dirty = !!draft.dirty; }
    else { S.spec = clone(A.BASE_FIGURE); S.sheet = A.blankSheet(); }
    if (!S.spec.props) S.spec.props = [];
    showStep(S.step); A.draw(); A.drawLineup(); whoami(); syncView(); syncBackups();
    /* the first view, from the hash (or the hot snapshot when there is none); quiet: the hash already says so */
    var sm = !h && saved ? saved.mode : null;
    pendingOpen = hashOpen() || (sm === 'sheet' && saved.open ? saved.open : null);
    if (pendingOpen) setMode('sheet', true);   /* the sheet opens once the files settle */
    else if (h === '#t' || h === '#t/schedule' || sm === 'table') { setMode('table', true); if (h === '#t/schedule') openSchedule(); }
    else if (h === '#print') setMode('print', true);
    else if (isRulesHash(h)) setMode('rules', true);
    else if (h === '#cast' || h.indexOf('#cast/') === 0) setMode('cast', true);
    else if (h === '#gm') setMode('gm', true);
    else if (h === '#display') setMode('display', true);
    else if (h === '#new') { setMode('create', true); newCharacter(); replaceHash('#create'); }
    else if (h === '#create' || fromHash || sm === 'create') setMode('create', true);
    else setMode('home', true);
    syncTitle();
    if (window.claude && window.claude.use) {
      window.claude.use('downloads').then(function (d) { downloads = d || null; syncBackups(); }).catch(function () {});
      var who = window.claude.use('user').then(function (u) {
        if (!u) return;
        userCap = u;
        if (hosted() && window.B68Runtime.me) A.myName = window.B68Runtime.me.name || '';
        else if (typeof u.me === 'function') Promise.resolve().then(function () { return u.me(); }).then(function (m) { A.myName = (m && m.name) || ''; renderHome(); }).catch(function () {});
        var pid = typeof u.id === 'function' ? Promise.resolve(u.id()) : Promise.resolve(null);
        return pid.then(function (id) { A.me = id || null; var cw = typeof u.can === 'function' ? Promise.resolve(u.can('data.write')) : Promise.resolve(null); return cw.then(function (c) { A.canWrite = c === true ? true : c === false ? false : null; return gmOf(u); }).then(function (g) { A.isGM = g === true; A.roleKnown = !!A.me; A.isDisplay = hosted() && !!window.B68Runtime.me && window.B68Runtime.me.role === 'display'; }); });
      }).catch(function () {});
      who.then(function () {
        whoami(); syncFilter(); A.syncAll(); syncNav();
        /* the GM pack is cached per browser (IndexedDB): a viewer KNOWN not to be the GM drops every cached copy (not when /api/me failed) */
        if (A.roleKnown === true && A.isGM !== true) purgeGm();
        if (A.isDisplay === true) return null;   /* the display sign-in may not read the files: no db, no roster, no campaign */
        return window.claude.use('db');
      }).then(function (d) {
        if (A.isDisplay === true) { db = null; dbSettled = true; setMode('display', true); replaceHash('#display'); return; }
        db = d; dbSettled = true; whoami(); A.syncAll(); syncBackups(); syncEditBar();
        startCampaign();
        var Cp0 = castMod(); if (Cp0) { try { Cp0.init(castApi()); } catch (e) { if (window.console) console.error(e); } }
        if (document.body.dataset.mode === 'table') startTable();
        if (!d) { $('rosterNote').textContent = 'Saved characters are not available in this view.'; cannotOpen('Saved characters are not available here, so that sheet cannot open.'); renderHome(); return; }
        $('rosterNote').textContent = A.me ? 'Yours are saved to your account. Everyone at the table can see all characters.' : 'Everyone who opens this page sees the same characters.';
        renderHome();
        col().orderBy('updatedAt', 'desc').limit(60).onSnapshot(function (snap) {
          var docs = [], seen = {};
          (snap.docs || []).forEach(function (doc) { var data = (doc.data && doc.data()) || {}; if (!data.spec) return; seen[doc.id] = true; cache[doc.id] = data; docs.push(Object.assign({ id: doc.id }, data)); });
          rosterSeen = true; renderRoster(docs);
          if (A._followCache && openId) A._followCache(openId);
          if (pendingOpen) { var id = pendingOpen; pendingOpen = null; openCharacter(id); }
        }, function (e) { rosterSeen = true; renderHome(); toast('Files offline: ' + (e && e.message || e), true); });
      }).catch(function () { dbSettled = true; cannotOpen('Saved characters are not available here, so that sheet cannot open.'); renderHome(); if (document.body.dataset.mode === 'table') startTable(); });
    } else { dbSettled = true; $('rosterNote').textContent = 'Saved characters are not available in this view.'; whoami(); syncBackups(); cannotOpen(''); renderHome(); if (document.body.dataset.mode === 'table') startTable(); }
  }
  if (hot && hot.ready) hot.ready(function (data) { boot(data || {}); }); else boot((hot && hot.data) || {});
})();
