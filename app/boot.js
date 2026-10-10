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
  var roster = [];
  A.drawLineup = function () {
    try {
      var you = A.renderSpec(); you.id = (you.id || 'you') + '-lu';
      var others = roster.length ? roster.slice(0, 6).map(function (d, i) { var s = clone(d.spec); s.id = 'r' + i + '-' + A.slug(d.name); s.name = d.name; s.playbook = d.playbookName || d.playbook; return s; }) : C.pcs.map(function (c) { return clone(c); });
      var all = others.concat([you]);
      var r = K.lineup(all, { chart: true, height: 380, lod: 'lo' });
      $('lineup').innerHTML = r.svg; var svg = $('lineup').querySelector('svg'); if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
      /* ghosts read as vapour: class the figure group of each Ghost/Echo in the line-up */
      var ghosts = {}; if (roster.length) roster.slice(0, 6).forEach(function (d, i) { var q = A.CT.byId[d.playbook]; if (q && q.ghost) ghosts['r' + i + '-' + A.slug(d.name)] = true; }); var mine = A.pbOf(); if (mine && mine.ghost) ghosts[you.id] = true;
      if (svg) Object.keys(ghosts).forEach(function (id) { svg.querySelectorAll('.b68-figure').forEach(function (g) { if (g.getAttribute('data-id') === id) g.classList.add('ghostly'); }); });
      $('lineupNames').innerHTML = all.map(function (c, i) { var last = i === all.length - 1; return '<span' + (last ? ' class="you"' : '') + '>' + esc(last ? (S.sheet.name || 'You') : c.name) + '<small>' + esc(last ? ((A.pbOf() || {}).name || 'the subject') : (c.playbook || '')) + ' · ' + A.feet(c.heightIn) + '</small></span>'; }).join('');
      $('crewNote').textContent = 'True height · 25 units per inch · ' + (roster.length ? 'the filed crew, then you' : 'the canon crew, then you');
    } catch (e) { $('lineup').innerHTML = '<div class="empty">The line-up could not be drawn: ' + esc(e.message) + '</div>'; }
  };

  /* ---------- the files: the characters collection, account, modes and routing ---------- */
  var db = null, dbSettled = false, chars = null;          /* chars: the collection handle */
  var openId = null, openUnsub = null, latest = null;      /* the character open in the sheet; latest = its newest data (no id) */
  var cache = {};                                           /* id -> data, from the collection snapshot */
  var filter = 'all', filterChosen = false, pendingOpen = null;
  A.me = null; A.canWrite = null; A.isGM = false;
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
  function loadIntoCreator(d) {
    S.spec = clone(d.spec || A.BASE_FIGURE); if (!S.spec.props) S.spec.props = [];
    S.sheet = normaliseSheet(d.sheet, d); S.sheet.docId = d.id; S.dirty = true;
    A.changed(); showStep(15); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  A.loadIntoCreator = loadIntoCreator;

  /* mode: create (the studio, line-up and files), sheet (the tracker in #dossier) or table (the campaign page in #table-page) */
  function setMode(m) {
    m = m === 'sheet' || m === 'table' ? m : 'create';
    var was = document.body.dataset.mode;
    document.body.dataset.mode = m;
    var dos = $('dossier'); if (dos) dos.hidden = m !== 'sheet';
    var tp = $('table-page'); if (tp) tp.hidden = m !== 'table';
    var rb = $('railBack'); if (rb) rb.hidden = m === 'create';
    var tb = $('tableBtn'); if (tb) tb.setAttribute('aria-pressed', String(m === 'table'));
    if (m !== 'sheet' && was === 'sheet') closeSheet();
    if (m !== 'table' && was === 'table') closeTable();
    if (m === 'table' && was !== 'table') startTable();
    if (A.snapshot) A.snapshot();
  }
  A.setMode = setMode;
  function closeSheet() {
    if (openUnsub) { try { openUnsub(); } catch (e) {} openUnsub = null; }
    var T = tracker(); if (T && T.isOpen && T.isOpen()) { try { T.close(); } catch (e) {} }
    openId = null; latest = null;
  }
  function clearHash() { if (!location.hash) return; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } }
  function goBack() { setMode('create'); clearHash(); var r = document.querySelector('.roster'); if (r && r.scrollIntoView) { try { r.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} } if (A.snapshot) A.snapshot(); }

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
    if (!db) { pendingOpen = id; if (dbSettled) toast('The files are not available in this view.', true); return; }
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
      edit: function () { var d = Object.assign({ id: id }, latest || cache[id] || {}); setMode('create'); clearHash(); loadIntoCreator(d); toast('Editing ' + (d.name || 'the character') + ' in the creator.'); },
      back: function () { goBack(); },
      remove: function () { var r2 = ref; return r2.delete().then(function () { delete cache[id]; toast('Removed from the files.'); goBack(); }).catch(function (e) { toast('Could not remove: ' + (e && e.message || e), true); throw e; }); },
      me: A.me, canWrite: A.canWrite
    };
    function arrived(data) {
      if (openId !== id) return;
      if (!data) { toast(first ? 'There is no such file.' : 'This file was removed.', true); goBack(); return; }
      latest = data; cache[id] = data;
      var doc = Object.assign({ id: id }, clone(data));
      try { if (first) { first = false; T.open(doc, api); } else if (T.update) T.update(doc); }
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
    try { if (location.hash !== '#c/' + id) location.hash = '#c/' + id; } catch (e) {}
    setMode('sheet'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  A.openCharacter = openCharacter;
  /* Change a filed character from outside its sheet (the crew sheet's bank payout): `patch.play` is merged over the
     character's stored play, and only what changed goes out through the same delta path as the sheet's own saves. */
  function updateCharacter(id, patch) {
    if (!db) return Promise.reject(new Error('The files are not available in this view.'));
    var before = (openId === id && latest) || cache[id];
    if (!before) return Promise.reject(new Error('There is no such file: ' + id));
    var full = {};
    Object.keys(patch || {}).forEach(function (k) { full[k] = k === 'play' && isObj(patch.play) ? Object.assign({}, isObj(before.play) ? clone(before.play) : {}, clone(patch.play)) : clone(patch[k]); });
    if (!Object.keys(full).some(function (k) { return !same(full[k], before[k]); })) return Promise.resolve(false);
    var after = Object.assign({}, before, full, { updatedAt: nowIso() }), delta = playDelta(before, full), ref = col().doc(id);
    cache[id] = after; if (openId === id) latest = after;
    var write = delta && typeof ref.update === 'function' ? ref.update(clone(delta)) : ref.set(clone(after));
    return write.then(function () { return true; }, function (e) { toast('Could not save ' + (before.name || 'the character') + ': ' + (e && e.message || e), true); throw e; });
  }
  A.updateCharacter = updateCharacter;

  /* ---------- the table: one shared campaign document, campaign/main (CAMPAIGN.md) ---------- */
  var tableRef = null, tableUnsub = null, tableLatest = null, tableExists = false;
  var NO_TABLE = 'The table needs the shared files. Open this page where the files are available (the published artifact or the hosted site) to see the crew, the clocks and the players.';
  function campaignMod() { var Cm = window.B68Campaign; return Cm && typeof Cm.open === 'function' ? Cm : null; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function deepMerge(t, s) { for (var k in s) { if (!Object.prototype.hasOwnProperty.call(s, k)) continue; var v = s[k]; if (isObj(v) && isObj(t[k])) deepMerge(t[k], v); else t[k] = v; } return t; }
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
  function tableApi(ref) {
    return {
      /* patch: changed top-level fields of session / crew / clocks / log (crew may be partial). Only what differs from the
         latest known document is sent; the first write to a missing document creates it whole. */
      save: function (patch) {
        if (tableRef !== ref) return Promise.reject(new Error('The table is closed.'));
        var before = tableLatest || {}, out = {}, any = false;
        ['session', 'crew', 'clocks', 'log'].forEach(function (k) {
          if (!patch || !Object.prototype.hasOwnProperty.call(patch, k)) return;
          var nv = patch[k], ov = before[k];
          if (k === 'crew' && isObj(nv)) { var sub = {}, s2 = false; for (var f in nv) if (Object.prototype.hasOwnProperty.call(nv, f) && !same(nv[f], isObj(ov) ? ov[f] : undefined)) { sub[f] = nv[f]; s2 = true; } if (s2) { out.crew = sub; any = true; } return; }
          if (!same(nv, ov)) { out[k] = nv; any = true; }
        });
        if (!any) return Promise.resolve(false);
        out.updatedAt = nowIso();
        var merged = deepMerge(clone(before), clone(out)), Cm = campaignMod(), write;
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
      },
      /* the whole document (PUT on the hosted API, GM only): removing a log line, which a patch can never do */
      replace: function (whole) {
        if (tableRef !== ref) return Promise.reject(new Error('The table is closed.'));
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
  function startTable() {
    var Cm = campaignMod(); if (!Cm) { toast('The table module is missing.', true); return; }
    if (tableRef) return;
    if (!dbSettled) { Cm.notice('Opening the table…'); return; }   /* boot calls again once the files settle */
    var ref = null; try { ref = db ? db.collection('campaign').doc('main') : null; } catch (e) { ref = null; }
    if (!ref) { Cm.notice(NO_TABLE, true); return; }
    tableRef = ref; tableLatest = null; tableExists = false;
    Cm.open(tableApi(ref));
    function arrived(snap) {
      if (tableRef !== ref) return;
      var data = snap && snap.exists !== false && typeof snap.data === 'function' ? snap.data() : null;
      if (!isObj(data)) data = null;
      tableExists = !!data; tableLatest = data ? clone(data) : null;
      try { Cm.update(data ? clone(data) : null); } catch (e) { toast('The table could not render: ' + (e && e.message || e), true); }
    }
    function failed(e) { if (tableRef !== ref) return; toast('The table is offline: ' + (e && e.message || e), true); }
    if (typeof ref.onSnapshot === 'function') { try { tableUnsub = ref.onSnapshot(arrived, failed); } catch (e) { tableUnsub = null; } }
    if (!tableUnsub) {
      tableUnsub = function () {};
      (typeof ref.get === 'function' ? Promise.resolve().then(function () { return ref.get(); }) : Promise.resolve(null)).then(arrived).catch(failed);
    }
  }
  function closeTable() {
    if (tableUnsub) { try { tableUnsub(); } catch (e) {} tableUnsub = null; }
    tableRef = null; tableLatest = null; tableExists = false;
    var Cm = campaignMod(); if (Cm && Cm.close) { try { Cm.close(); } catch (e) {} }
  }
  function openTable() {
    setMode('table');
    try { if (location.hash !== '#t') location.hash = '#t'; } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  A.openTable = openTable;

  /* roster */
  var roster = [];
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
  function emptyHtml() { return '<div class="empty">' + (roster.length ? 'None of these are yours yet. File a character from the last step and it is saved to your account.' : 'No one is on file yet. Finish the dossier and file the character from the last step: that opens the living sheet, and the file appears here.') + '</div>'; }
  function renderTable(list) {
    var box = $('table'); if (!box) return;
    if (!list.length) { box.innerHTML = emptyHtml(); return; }
    var t = el('table', 'tbl'); t.setAttribute('aria-label', 'The table');
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
  function renderRoster(docs) {
    roster = docs || []; syncFilter(); syncView(); syncBackups();
    if (tableRef) { var Cm = campaignMod(); if (Cm && Cm.rosterChanged) { try { Cm.rosterChanged(); } catch (e) {} } }
    var box = $('cards'), list = visibleDocs();
    if (view === 'table') { renderTable(list); A.drawLineup(); return; }
    if (!list.length) { box.innerHTML = emptyHtml(); A.drawLineup(); return; }
    box.innerHTML = '';
    list.forEach(function (d) {
      var card = el('div', 'card' + (A.me && d.owner === A.me ? ' mine' : '')); card.setAttribute('role', 'button'); card.tabIndex = 0; card.title = 'Open the sheet';
      var pic = el('div', 'pic' + ((A.CT.byId[d.playbook] || {}).ghost ? ' ghostly' : '')); try { var s = clone(d.spec); s.id = 'c-' + d.id; pic.innerHTML = K.render(s, { height: 150, lod: 'lo', shadow: false }).svg; var sv = pic.querySelector('svg'); if (sv) { sv.removeAttribute('width'); sv.removeAttribute('height'); } } catch (e) { pic.textContent = '?'; }
      var meta = el('div', 'meta'); meta.innerHTML = '<span class="nm">' + esc(d.name || 'Unnamed') + '</span><span class="cd">' + esc((d.playbookName || pbName(d.playbook)) + (d.code ? ' · ' + d.code : '')) + '</span><span class="st">' + esc(playStatus(d)) + '</span>';
      var acts = el('div', 'acts'); var ed = el('span', 'ed', 'Edit figure'); ed.setAttribute('role', 'button'); ed.tabIndex = 0; ed.title = 'Load into the creator';
      ed.onclick = function (ev) { ev.stopPropagation(); setMode('create'); clearHash(); loadIntoCreator(d); toast('Loaded ' + (d.name || 'the character') + ' into the creator.'); };
      ed.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ed.onclick(ev); } };
      acts.appendChild(ed); meta.appendChild(acts);
      card.appendChild(pic); card.appendChild(meta);
      var rm = el('span', 'rm', 'remove'); rm.setAttribute('role', 'button'); rm.tabIndex = 0; rm.title = 'Remove from the files'; var armed = false;
      rm.onclick = function (ev) { ev.stopPropagation(); if (!db) { toast('The files are not available in this view.', true); return; } if (armed) { col().doc(d.id).delete().then(function () { delete cache[d.id]; }).catch(function (e) { toast('Could not remove: ' + (e.message || e), true); }); } else { armed = true; rm.textContent = 'sure?'; setTimeout(function () { armed = false; rm.textContent = 'remove'; }, 2500); } };
      card.appendChild(rm);
      card.onclick = function () { openCharacter(d.id); };
      card.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openCharacter(d.id); } };
      box.appendChild(card);
    });
    A.drawLineup();
  }
  A._renderRoster = renderRoster;
  try { Object.defineProperty(A, 'roster', { get: function () { return roster; } }); } catch (e) {}
  var rf = $('rosterFilter'); if (rf) rf.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { filter = b.dataset.f; filterChosen = true; renderRoster(roster); }; });
  var rv = $('rosterView'); if (rv) rv.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { setRosterView(b.dataset.v); }; });

  /* ---------- backups: every file in the current filter as one JSON; restore files each as a new document ---------- */
  function syncBackups() {
    var b = $('backups'), dl = $('dlAll'), rs = $('restoreBtn'); if (!b) return;
    if (dl) dl.hidden = !downloads;
    if (rs) rs.hidden = !db || A.canWrite === false;
    b.hidden = (!dl || dl.hidden) && (!rs || rs.hidden);
  }
  function downloadAll() {
    var list = visibleDocs(); if (!list.length) { toast('Nothing to download yet.', true); return; }
    var data = { v: 1, exportedAt: nowIso(), characters: list.map(function (d) { return clone(d); }) };
    saveFile('blades68-characters-' + data.exportedAt.slice(0, 10) + '.json', JSON.stringify(data, null, 2));
  }
  function validBackupDoc(c) { return !!c && typeof c === 'object' && !Array.isArray(c) && typeof c.playbook === 'string' && !!A.CT.byId[c.playbook] && !!c.sheet && typeof c.sheet === 'object' && !Array.isArray(c.sheet); }
  function restoreDocs(data) {
    if (!db) { toast('The files are not available in this view.', true); return Promise.resolve(0); }
    if (!data || typeof data !== 'object' || !Array.isArray(data.characters)) { toast('That is not a Blades ’68 backup: no characters list.', true); return Promise.resolve(0); }
    if (data.v !== 1) { toast('Unknown backup version ' + data.v + '. Expected 1.', true); return Promise.resolve(0); }
    var good = [], bad = 0;
    data.characters.forEach(function (c) { if (validBackupDoc(c)) good.push(c); else bad++; });
    if (!good.length) { toast(bad ? 'Nothing restorable: ' + bad + ' invalid entr' + (bad === 1 ? 'y' : 'ies') + '.' : 'The backup is empty.', true); return Promise.resolve(0); }
    var T = tracker(), used = {}, n = 0, seq = Promise.resolve();
    good.forEach(function (c) {
      seq = seq.then(function () {
        var now = nowIso(), name = String(c.name || c.sheet.name || 'Unnamed');
        var sheet = normaliseSheet(c.sheet, c); delete sheet.docId;
        var base = A.slug(name) + '-' + Date.now().toString(36), id = base, k = 0; while (used[id] || cache[id]) id = base + '-' + (++k).toString(36); used[id] = true;
        var play = null; if (c.play && typeof c.play === 'object' && !Array.isArray(c.play)) play = clone(c.play); else if (T && T.initialPlay) { try { play = T.initialPlay(clone(sheet), c.playbook) || {}; } catch (e) { play = {}; } } else play = {};
        var spec = c.spec && typeof c.spec === 'object' && !Array.isArray(c.spec) ? clone(c.spec) : clone(A.BASE_FIGURE); if (!spec.props) spec.props = [];
        var doc = { v: 2, name: name, alias: String(c.alias || sheet.alias || ''), code: String(c.code || spec.code || ''), playbook: c.playbook, playbookName: String(c.playbookName || pbName(c.playbook)), spec: spec, sheet: sheet, play: play, owner: A.me || null, createdAt: now, updatedAt: now };
        return col().doc(id).set(doc).then(function () { cache[id] = doc; n++; });
      });
    });
    return seq.then(function () { toast('Restored ' + n + ' character' + (n === 1 ? '' : 's') + (bad ? ' · skipped ' + bad + ' invalid' : '') + '.'); return n; })
      .catch(function (e) { toast('Restore stopped after ' + n + ': ' + (e && e.message || e), true); return n; });
  }
  A.restoreDocs = restoreDocs;
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
    if (!db) { toast('Filing is not available in this view.', true); return; }
    if (!S.sheet.name) { toast('Give the character a name first (Identity step).', true); showStep(14); return; }
    var fields = docFields(), id = S.sheet.docId;
    function create() {
      id = A.slug(S.sheet.name) + '-' + Date.now().toString(36);
      var play = {}; var T = tracker(); if (T && T.initialPlay) { try { play = T.initialPlay(clone(S.sheet), S.sheet.playbook) || {}; } catch (e) { play = {}; } }
      var doc = Object.assign(fields, { play: play, owner: A.me || null, createdAt: fields.updatedAt });
      return col().doc(id).set(doc).then(function () { cache[id] = doc; S.sheet.docId = id; S.dirty = false; A.changed(); toast('Filed ' + S.sheet.name + '. Opening the sheet.'); openCharacter(id); });
    }
    var done;
    if (id) {
      var ref = col().doc(id);
      var p = typeof ref.get === 'function' ? ref.get().then(function (snap) { return snap && snap.exists !== false && typeof snap.data === 'function' ? snap.data() : null; }) : Promise.resolve(cache[id] || null);
      done = p.then(function (cur) {
        if (!cur) return create();
        var doc = Object.assign({}, cur, fields, { play: cur.play || {}, owner: cur.owner === undefined ? (A.me || null) : cur.owner, createdAt: cur.createdAt || fields.updatedAt });
        return ref.set(doc).then(function () { cache[id] = doc; if (openId === id) latest = doc; S.dirty = false; A.changed(); toast('Updated the file for ' + S.sheet.name + '.'); openCharacter(id); });
      });
    } else done = create();
    done.catch(function (e) { toast('Could not file: ' + (e && e.message || e), true); });
  }
  A.fileCharacter = fileCharacter;
  function newCharacter() {
    if (S.dirty && !window.confirm('Start a new character? The one in the creator is cleared' + (S.sheet.docId ? ' (the filed copy stays in the files)' : '') + '.')) return;
    S.spec = clone(A.BASE_FIGURE); S.sheet = A.blankSheet(); S.dirty = false; S.view = 'figure';
    A.changed(); showStep(0); A.draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); toast('A blank form.');
  }
  A.newCharacter = newCharacter;

  /* ---------- exports ---------- */
  var downloads = null;
  function fileBase() { return A.slug(S.sheet.name || S.spec.id || 'subject'); }
  function saveFile(name, data) { if (!downloads) { toast('Saving files is not available in this view. Copy the sheet instead.', true); return; } downloads.save({ filename: name, data: data }).then(function () { toast('Saved ' + name); }).catch(function (e) { if (e && e.code === 'declined') return; toast('Could not save: ' + (e && e.message || e), true); }); }
  function copyText(txt, ok) { var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(txt) : Promise.reject(); p.then(function () { toast(ok); }).catch(function () { var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:160px;z-index:9;font:12px var(--font-mono)'; document.body.appendChild(ta); ta.focus(); ta.select(); toast('Copy blocked here. The text is selected; copy it, then click away.', true); ta.onblur = function () { ta.remove(); }; }); }
  function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64url(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('button'); if (!b) return;
    switch (b.id) {
      case 'fileRoster': fileCharacter(); break;
      case 'openSheet': if (S.sheet.docId) openCharacter(S.sheet.docId); break;
      case 'newChar': newCharacter(); break;
      case 'railBack': goBack(); break;
      case 'tableBtn': openTable(); break;
      case 'dlAll': downloadAll(); break;
      case 'restoreBtn': (function () { var i = $('restoreFile'); if (!db) { toast('The files are not available in this view.', true); return; } if (i) i.click(); })(); break;
      case 'dlSvg': saveFile(fileBase() + '.svg', A.figureSvg(900)); break;
      case 'dlMug': saveFile(fileBase() + '-mugshot.svg', A.mugshot().svg); break;
      case 'dlPng': (function () { var svg = S.view === 'mug' ? A.mugshot().svg : A.figureSvg(900); var m = svg.match(/viewBox="([^"]+)"/); var vb = m ? m[1].split(/\s+/).map(parseFloat) : [0, 0, 540, 900]; var H = 1600, W = Math.round(H * vb[2] / vb[3]); var img = new Image(); var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); img.onload = function () { try { var c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d'); g.fillStyle = '#e8e2d4'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H); c.toBlob(function (bl) { URL.revokeObjectURL(url); if (bl) saveFile(fileBase() + (S.view === 'mug' ? '-mugshot' : '') + '.png', bl); else toast('Could not rasterise the figure.', true); }, 'image/png'); } catch (e) { toast('Could not rasterise: ' + e.message, true); } }; img.onerror = function () { URL.revokeObjectURL(url); toast('Could not rasterise the figure.', true); }; img.src = url; })(); break;
      case 'copySheet': copyText(A.sheetMarkdown(), 'Sheet copied as Markdown.'); break;
      case 'copySpec': copyText(JSON.stringify(S.spec, null, 2), 'Figure spec copied as JSON.'); break;
      case 'copyLink': copyText(location.href.split('#')[0] + '#s' + b64url(JSON.stringify({ spec: S.spec, sheet: Object.assign({}, S.sheet, { docId: undefined }) })), 'Link copied. It carries the whole character.'); break;
    }
  });

  /* ---------- boot ---------- */
  A.snapshot = function () { if (hot && hot.snapshot) { try { hot.snapshot(function () { return { spec: S.spec, sheet: S.sheet, step: S.step, view: S.view, dirty: S.dirty, mode: document.body.dataset.mode || 'create', open: openId }; }); } catch (e) {} } };
  function whoami() {
    var w = $('whoami'); if (!w) return;
    var rt = window.B68Runtime, hosted = !!(rt && rt.kind === 'cloudflare');
    if (A.me) {
      var who = hosted && rt.me ? (rt.me.name || rt.me.email || '') : '';
      w.textContent = who ? 'Signed in as ' + who + (rt.me.role === 'gm' ? ' · GM' : '') + ' · ' : 'Signed in · your files are saved to your account';
      if (who) { var out = document.createElement('a'); out.href = '/cdn-cgi/access/logout'; out.textContent = 'Sign out'; out.className = 'signout'; w.appendChild(out); }
      w.classList.remove('off');
    }
    else if (hosted) { w.textContent = 'Not signed in · '; var inl = document.createElement('a'); inl.href = location.pathname; inl.textContent = 'Sign in'; inl.className = 'signout'; w.appendChild(inl); w.classList.add('off'); }
    else { w.textContent = db ? 'Not signed in · files are not marked as yours' : 'Not signed in · filing unavailable'; w.classList.add('off'); }
  }
  function hashOpen() { var h = location.hash || ''; return h.indexOf('#c/') === 0 ? decodeURIComponent(h.slice(3)) : null; }
  window.addEventListener('hashchange', function () {
    var id = hashOpen(), m = document.body.dataset.mode;
    if (location.hash === '#t') { if (m !== 'table') openTable(); }
    else if (id) { if (id !== openId) openCharacter(id); }
    else if (m === 'sheet' || m === 'table') setMode('create');
  });
  /* the GM: user.canEdit() when it answers a boolean, else user.isOwner(), else not */
  function gmOf(u) {
    function ask(fn) { return typeof fn === 'function' ? Promise.resolve().then(function () { return fn.call(u); }).catch(function () { return undefined; }) : Promise.resolve(undefined); }
    return ask(u.canEdit).then(function (v) { return typeof v === 'boolean' ? v : ask(u.isOwner).then(function (w) { return w === true; }); });
  }
  function boot(saved) {
    var fromHash = null;
    try { if (location.hash && location.hash.length > 24 && location.hash[1] === 's') fromHash = JSON.parse(unb64url(location.hash.slice(2))); } catch (e) { fromHash = null; }
    if (saved && saved.spec && saved.sheet) { S.spec = saved.spec; S.sheet = normaliseSheet(saved.sheet); S.step = saved.step || 0; S.view = saved.view || 'figure'; S.dirty = !!saved.dirty; }
    else if (fromHash && fromHash.spec) { S.spec = fromHash.spec; S.sheet = normaliseSheet(fromHash.sheet); S.dirty = true; S.step = 15; }
    else { S.spec = clone(A.BASE_FIGURE); S.sheet = A.blankSheet(); }
    if (!S.spec.props) S.spec.props = [];
    $('kitVersion').textContent = 'figure kit v' + (K.version || '2') + ' · ' + A.O.hair.length + ' hairstyles · ' + A.O.prop.length + ' props · 16 steps';
    setMode('create'); showStep(S.step); A.draw(); A.drawLineup(); whoami(); syncView(); syncBackups();
    pendingOpen = hashOpen() || (saved && saved.mode === 'sheet' && saved.open ? saved.open : null);
    if (!pendingOpen && (location.hash === '#t' || (saved && saved.mode === 'table' && !location.hash))) openTable();
    if (window.claude && window.claude.use) {
      window.claude.use('downloads').then(function (d) { downloads = d || null; syncBackups(); }).catch(function () {});
      var who = window.claude.use('user').then(function (u) {
        if (!u) return;
        userCap = u;
        var pid = typeof u.id === 'function' ? Promise.resolve(u.id()) : Promise.resolve(null);
        return pid.then(function (id) { A.me = id || null; var cw = typeof u.can === 'function' ? Promise.resolve(u.can('data.write')) : Promise.resolve(null); return cw.then(function (c) { A.canWrite = c === true ? true : c === false ? false : null; return gmOf(u); }).then(function (g) { A.isGM = g === true; }); });
      }).catch(function () {});
      who.then(function () { whoami(); syncFilter(); A.syncAll(); return window.claude.use('db'); }).then(function (d) {
        db = d; dbSettled = true; whoami(); A.syncAll(); syncBackups();
        if (document.body.dataset.mode === 'table') startTable();
        if (!d) { $('rosterNote').textContent = 'The files are unavailable in this view'; if (pendingOpen) { toast('The files are not available here, so that sheet cannot open.', true); pendingOpen = null; } return; }
        $('rosterNote').textContent = A.me ? 'Yours are saved to your account · everyone with the link sees the shared files' : 'Everyone who opens this page sees the same files';
        col().orderBy('updatedAt', 'desc').limit(60).onSnapshot(function (snap) {
          var docs = [], seen = {};
          (snap.docs || []).forEach(function (doc) { var data = (doc.data && doc.data()) || {}; if (!data.spec) return; seen[doc.id] = true; cache[doc.id] = data; docs.push(Object.assign({ id: doc.id }, data)); });
          renderRoster(docs);
          if (A._followCache && openId) A._followCache(openId);
          if (pendingOpen) { var id = pendingOpen; pendingOpen = null; openCharacter(id); }
        }, function (e) { toast('Files offline: ' + (e && e.message || e), true); });
      }).catch(function () { dbSettled = true; if (document.body.dataset.mode === 'table') startTable(); });
    } else { dbSettled = true; $('rosterNote').textContent = 'The files are unavailable in this view'; whoami(); syncBackups(); if (pendingOpen) { pendingOpen = null; clearHash(); } if (document.body.dataset.mode === 'table') startTable(); }
  }
  if (hot && hot.ready) hot.ready(function (data) { boot(data || {}); }); else boot((hot && hot.data) || {});
})();
