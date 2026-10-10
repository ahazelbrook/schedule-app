/* Boot: the step rail, navigation, the crew line-up, the files (characters collection, account, modes and routing), exports, and hot reload. */
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
      case 9: return !!(sh.ability || sh.customAbility);
      case 10: return !!p && (p.hull || (sh.keys || []).length >= 2);
      case 11: return !!p && (p.hull || Object.keys(sh.contacts || {}).length >= 2);
      case 12: return !!p && (p.hull || (!!sh.vice && !!sh.purveyor));
      case 13: return (sh.items || []).length > 0;
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
    if (S.step === 2 && S.view !== 'mug') setView('mug'); else if (S.step !== 2 && S.view !== 'figure' && S.step < 15) setView('figure');
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
      $('lineupNames').innerHTML = all.map(function (c, i) { var last = i === all.length - 1; return '<span' + (last ? ' class="you"' : '') + '>' + esc(last ? (S.sheet.name || 'You') : c.name) + '<small>' + esc(last ? ((A.pbOf() || {}).name || 'the subject') : (c.playbook || '')) + ' · ' + A.feet(c.heightIn) + '</small></span>'; }).join('');
      $('crewNote').textContent = 'True height · 25 units per inch · ' + (roster.length ? 'the filed crew, then you' : 'the canon crew, then you');
    } catch (e) { $('lineup').innerHTML = '<div class="empty">The line-up could not be drawn: ' + esc(e.message) + '</div>'; }
  };

  /* ---------- the files: the characters collection, account, modes and routing ---------- */
  var db = null, dbSettled = false, chars = null;          /* chars: the collection handle */
  var openId = null, openUnsub = null, latest = null;      /* the character open in the sheet; latest = its newest data (no id) */
  var cache = {};                                           /* id -> data, from the collection snapshot */
  var filter = 'all', filterChosen = false, pendingOpen = null;
  A.me = null; A.canWrite = null;
  A.filingAvailable = function () { return !!db; };
  function nowIso() { return new Date().toISOString(); }
  function tracker() { var T = window.B68Tracker; return T && typeof T.open === 'function' ? T : null; }
  function pbName(id) { var p = A.CT.byId[id]; return p ? p.name : (id || ''); }
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

  /* mode: create (the studio, line-up and files) or sheet (the tracker in #dossier) */
  function setMode(m) {
    m = m === 'sheet' ? 'sheet' : 'create';
    var was = document.body.dataset.mode;
    document.body.dataset.mode = m;
    var dos = $('dossier'); if (dos) dos.hidden = m !== 'sheet';
    var rb = $('railBack'); if (rb) rb.hidden = m !== 'sheet';
    if (m !== 'sheet' && was === 'sheet') closeSheet();
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
        latest = Object.assign({}, latest || {}, patch || {}, { updatedAt: nowIso() });
        cache[id] = latest;
        return ref.set(clone(latest)).catch(function (e) { toast('Could not save: ' + (e && e.message || e), true); throw e; });
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

  /* roster */
  var roster = [];
  function playStatus(d) {
    var p = d.play; if (!p || typeof p !== 'object') return 'new sheet';
    var pb = A.CT.byId[d.playbook] || {}; var bits = [];
    var stress = typeof p.stress === 'number' ? p.stress : null; if (stress != null) bits.push((pb.hull ? 'drain ' : 'stress ') + stress + '/' + (pb.hull ? 10 : 9));
    var h = p.harm || {}, n = 0; ['l1', 'l2', 'l3', 'l4'].forEach(function (k) { var v = h[k]; if (Array.isArray(v)) v.forEach(function (t) { if (t) n++; }); else if (v) n++; }); if (n) bits.push(n + ' harm');
    if (p.xp && typeof p.xp.playbook === 'number') bits.push('xp ' + p.xp.playbook + '/8');
    if (typeof p.stacks === 'number' && p.stacks) bits.push(p.stacks + ' stacks');
    return bits.join(' · ') || 'fresh sheet';
  }
  function visibleDocs() { return filter === 'mine' && A.me ? roster.filter(function (d) { return d.owner === A.me; }) : roster; }
  function syncFilter() {
    var seg = $('rosterFilter'); if (!seg) return;
    var mine = roster.some(function (d) { return A.me && d.owner === A.me; });
    seg.hidden = !A.me;
    if (!filterChosen) filter = (A.me && mine) ? 'mine' : 'all';
    seg.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.f === filter)); });
  }
  function renderRoster(docs) {
    roster = docs || []; syncFilter();
    var box = $('cards'), list = visibleDocs();
    if (!list.length) { box.innerHTML = '<div class="empty">' + (roster.length ? 'None of these are yours yet. File a character from the last step and it is saved to your account.' : 'No one is on file yet. Finish the dossier and file the character from the last step: that opens the living sheet, and the file appears here.') + '</div>'; A.drawLineup(); return; }
    box.innerHTML = '';
    list.forEach(function (d) {
      var card = el('div', 'card' + (A.me && d.owner === A.me ? ' mine' : '')); card.setAttribute('role', 'button'); card.tabIndex = 0; card.title = 'Open the sheet';
      var pic = el('div', 'pic'); try { var s = clone(d.spec); s.id = 'c-' + d.id; pic.innerHTML = K.render(s, { height: 150, lod: 'lo', shadow: false }).svg; var sv = pic.querySelector('svg'); if (sv) { sv.removeAttribute('width'); sv.removeAttribute('height'); } } catch (e) { pic.textContent = '?'; }
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
  var rf = $('rosterFilter'); if (rf) rf.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { filter = b.dataset.f; filterChosen = true; renderRoster(roster); }; });

  function docFields() {
    var p = A.pbOf() || {};
    if (A.wearingText) S.sheet.wearing = A.wearingText();
    var sheet = clone(S.sheet); delete sheet.docId;
    return { v: 2, name: S.sheet.name, alias: S.sheet.alias || '', code: S.spec.code || '', playbook: S.sheet.playbook || null, playbookName: p.name || '', spec: clone(S.spec), sheet: sheet, updatedAt: nowIso() };
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
    if (A.me) { w.textContent = 'Signed in · your files are saved to your account'; w.classList.remove('off'); }
    else { w.textContent = db ? 'Not signed in · files are not marked as yours' : 'Not signed in · filing unavailable'; w.classList.add('off'); }
  }
  function hashOpen() { var h = location.hash || ''; return h.indexOf('#c/') === 0 ? decodeURIComponent(h.slice(3)) : null; }
  window.addEventListener('hashchange', function () {
    var id = hashOpen();
    if (id) { if (id !== openId) openCharacter(id); }
    else if (document.body.dataset.mode === 'sheet') setMode('create');
  });
  function boot(saved) {
    var fromHash = null;
    try { if (location.hash && location.hash.length > 24 && location.hash[1] === 's') fromHash = JSON.parse(unb64url(location.hash.slice(2))); } catch (e) { fromHash = null; }
    if (saved && saved.spec && saved.sheet) { S.spec = saved.spec; S.sheet = normaliseSheet(saved.sheet); S.step = saved.step || 0; S.view = saved.view || 'figure'; S.dirty = !!saved.dirty; }
    else if (fromHash && fromHash.spec) { S.spec = fromHash.spec; S.sheet = normaliseSheet(fromHash.sheet); S.dirty = true; S.step = 15; }
    else { S.spec = clone(A.BASE_FIGURE); S.sheet = A.blankSheet(); }
    if (!S.spec.props) S.spec.props = [];
    $('kitVersion').textContent = 'figure kit v' + (K.version || '2') + ' · ' + A.O.hair.length + ' hairstyles · ' + A.O.prop.length + ' props · 16 steps';
    setMode('create'); showStep(S.step); A.draw(); A.drawLineup(); whoami();
    pendingOpen = hashOpen() || (saved && saved.mode === 'sheet' && saved.open ? saved.open : null);
    if (window.claude && window.claude.use) {
      window.claude.use('downloads').then(function (d) { downloads = d; }).catch(function () {});
      var who = window.claude.use('user').then(function (u) {
        if (!u) return;
        var pid = typeof u.id === 'function' ? Promise.resolve(u.id()) : Promise.resolve(null);
        return pid.then(function (id) { A.me = id || null; var cw = typeof u.can === 'function' ? Promise.resolve(u.can('data.write')) : Promise.resolve(null); return cw.then(function (c) { A.canWrite = c === true ? true : c === false ? false : null; }); });
      }).catch(function () {});
      who.then(function () { whoami(); syncFilter(); A.syncAll(); return window.claude.use('db'); }).then(function (d) {
        db = d; dbSettled = true; whoami(); A.syncAll();
        if (!d) { $('rosterNote').textContent = 'The files are unavailable in this view'; if (pendingOpen) { toast('The files are not available here, so that sheet cannot open.', true); pendingOpen = null; } return; }
        $('rosterNote').textContent = A.me ? 'Yours are saved to your account · everyone with the link sees the shared files' : 'Everyone who opens this page sees the same files';
        col().orderBy('updatedAt', 'desc').limit(60).onSnapshot(function (snap) {
          var docs = [], seen = {};
          (snap.docs || []).forEach(function (doc) { var data = (doc.data && doc.data()) || {}; if (!data.spec) return; seen[doc.id] = true; cache[doc.id] = data; docs.push(Object.assign({ id: doc.id }, data)); });
          renderRoster(docs);
          if (A._followCache && openId) A._followCache(openId);
          if (pendingOpen) { var id = pendingOpen; pendingOpen = null; openCharacter(id); }
        }, function (e) { toast('Files offline: ' + (e && e.message || e), true); });
      }).catch(function () { dbSettled = true; });
    } else { dbSettled = true; $('rosterNote').textContent = 'The files are unavailable in this view'; whoami(); if (pendingOpen) { pendingOpen = null; clearHash(); } }
  }
  if (hot && hot.ready) hot.ready(function (data) { boot(data || {}); }); else boot((hot && hot.data) || {});
})();
