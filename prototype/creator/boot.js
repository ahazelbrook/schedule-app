/* Boot: the step rail, navigation, the crew line-up, the shared roster, exports, and hot reload. */
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
      var others = roster.length ? roster.slice(0, 6).map(function (d, i) { var s = clone(d.spec); s.id = 'r' + i + '-' + A.slug(d.name); s.name = d.name; s.playbook = d.playbook; return s; }) : C.pcs.map(function (c) { return clone(c); });
      var all = others.concat([you]);
      var r = K.lineup(all, { chart: true, height: 380, lod: 'lo' });
      $('lineup').innerHTML = r.svg; var svg = $('lineup').querySelector('svg'); if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); }
      $('lineupNames').innerHTML = all.map(function (c, i) { var last = i === all.length - 1; return '<span' + (last ? ' class="you"' : '') + '>' + esc(last ? (S.sheet.name || 'You') : c.name) + '<small>' + esc(last ? ((A.pbOf() || {}).name || 'the subject') : (c.playbook || '')) + ' · ' + A.feet(c.heightIn) + '</small></span>'; }).join('');
      $('crewNote').textContent = 'True height · 25 units per inch · ' + (roster.length ? 'the filed crew, then you' : 'the canon crew, then you');
    } catch (e) { $('lineup').innerHTML = '<div class="empty">The line-up could not be drawn: ' + esc(e.message) + '</div>'; }
  };

  /* ---------- roster (shared, via db) ---------- */
  var db = null;
  function renderRoster(docs) {
    roster = docs; var box = $('cards');
    if (!docs.length) { box.innerHTML = '<div class="empty">No one is on file yet. Finish the dossier and file the subject from the last step; they appear here for everyone with the link, and a click loads them back into the creator.</div>'; A.drawLineup(); return; }
    box.innerHTML = '';
    docs.forEach(function (d) {
      var card = el('button', 'card'); card.type = 'button';
      var pic = el('div', 'pic'); try { var s = clone(d.spec); s.id = 'c-' + d.id; pic.innerHTML = K.render(s, { height: 150, lod: 'lo', shadow: false }).svg; var sv = pic.querySelector('svg'); if (sv) { sv.removeAttribute('width'); sv.removeAttribute('height'); } } catch (e) { pic.textContent = '?'; }
      var meta = el('div', 'meta'); meta.innerHTML = '<span class="nm">' + esc(d.name || 'Unnamed') + '</span><span class="cd">' + esc((d.playbook || '') + (d.code ? ' · ' + d.code : '')) + '</span>';
      card.appendChild(pic); card.appendChild(meta);
      var rm = el('span', 'rm', 'remove'); rm.setAttribute('role', 'button'); rm.tabIndex = 0; rm.title = 'Remove from the files'; var armed = false;
      rm.onclick = function (ev) { ev.stopPropagation(); if (armed) { db.collection('crew').doc(d.id).delete().catch(function (e) { toast('Could not remove: ' + (e.message || e), true); }); } else { armed = true; rm.textContent = 'sure?'; setTimeout(function () { armed = false; rm.textContent = 'remove'; }, 2500); } };
      card.appendChild(rm);
      card.onclick = function () { S.spec = clone(d.spec); S.sheet = Object.assign(A.blankSheet(), clone(d.sheet || {})); S.dirty = true; A.changed(); showStep(15); window.scrollTo({ top: 0, behavior: 'smooth' }); toast('Loaded ' + (d.name || 'subject') + ' from the files.'); };
      box.appendChild(card);
    });
    A.drawLineup();
  }
  function fileCharacter() {
    if (!db) { toast('Filing is not available in this view.', true); return; }
    if (!S.sheet.name) { toast('Give the character a name first (Identity step).', true); showStep(14); return; }
    var id = A.slug(S.sheet.name) + '-' + Date.now().toString(36);
    db.collection('crew').doc(id).set({ name: S.sheet.name, alias: S.sheet.alias || '', playbook: (A.pbOf() || {}).name || '', code: S.spec.code || '', spec: clone(S.spec), sheet: clone(S.sheet), savedAt: new Date().toISOString() })
      .then(function () { toast('Filed ' + S.sheet.name + '.'); }).catch(function (e) { toast('Could not file: ' + (e && e.message || e), true); });
  }

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
      case 'dlSvg': saveFile(fileBase() + '.svg', A.figureSvg(900)); break;
      case 'dlMug': saveFile(fileBase() + '-mugshot.svg', A.mugshot().svg); break;
      case 'dlPng': (function () { var svg = S.view === 'mug' ? A.mugshot().svg : A.figureSvg(900); var m = svg.match(/viewBox="([^"]+)"/); var vb = m ? m[1].split(/\s+/).map(parseFloat) : [0, 0, 540, 900]; var H = 1600, W = Math.round(H * vb[2] / vb[3]); var img = new Image(); var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); img.onload = function () { try { var c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d'); g.fillStyle = '#e8e2d4'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H); c.toBlob(function (bl) { URL.revokeObjectURL(url); if (bl) saveFile(fileBase() + (S.view === 'mug' ? '-mugshot' : '') + '.png', bl); else toast('Could not rasterise the figure.', true); }, 'image/png'); } catch (e) { toast('Could not rasterise: ' + e.message, true); } }; img.onerror = function () { URL.revokeObjectURL(url); toast('Could not rasterise the figure.', true); }; img.src = url; })(); break;
      case 'copySheet': copyText(A.sheetMarkdown(), 'Sheet copied as Markdown.'); break;
      case 'copySpec': copyText(JSON.stringify(S.spec, null, 2), 'Figure spec copied as JSON.'); break;
      case 'copyLink': copyText(location.href.split('#')[0] + '#s' + b64url(JSON.stringify({ spec: S.spec, sheet: S.sheet })), 'Link copied. It carries the whole character.'); break;
    }
  });

  /* ---------- boot ---------- */
  A.snapshot = function () { if (hot && hot.snapshot) { try { hot.snapshot(function () { return { spec: S.spec, sheet: S.sheet, step: S.step, view: S.view, dirty: S.dirty }; }); } catch (e) {} } };
  function boot(saved) {
    var fromHash = null;
    try { if (location.hash && location.hash.length > 24 && location.hash[1] === 's') fromHash = JSON.parse(unb64url(location.hash.slice(2))); } catch (e) { fromHash = null; }
    if (saved && saved.spec && saved.sheet) { S.spec = saved.spec; S.sheet = Object.assign(A.blankSheet(), saved.sheet); S.step = saved.step || 0; S.view = saved.view || 'figure'; S.dirty = !!saved.dirty; }
    else if (fromHash && fromHash.spec) { S.spec = fromHash.spec; S.sheet = Object.assign(A.blankSheet(), fromHash.sheet || {}); S.dirty = true; S.step = 15; }
    else { S.spec = clone(A.BASE_FIGURE); S.sheet = A.blankSheet(); }
    if (!S.spec.props) S.spec.props = [];
    $('kitVersion').textContent = 'figure kit v' + (K.version || '2') + ' · ' + A.O.hair.length + ' hairstyles · ' + A.O.prop.length + ' props · 16 steps';
    showStep(S.step); A.draw(); A.drawLineup();
    if (window.claude && window.claude.use) {
      window.claude.use('downloads').then(function (d) { downloads = d; }).catch(function () {});
      window.claude.use('db').then(function (d) {
        db = d;
        if (!d) { $('rosterNote').textContent = 'Filing is unavailable in this view'; return; }
        d.collection('crew').orderBy('savedAt', 'desc').limit(40).onSnapshot(function (snap) {
          var docs = []; (snap.docs || []).forEach(function (doc) { var data = (doc.data && doc.data()) || {}; if (data.spec) docs.push({ id: doc.id, name: data.name, alias: data.alias, playbook: data.playbook, code: data.code, spec: data.spec, sheet: data.sheet }); });
          renderRoster(docs);
        }, function (e) { toast('Files offline: ' + (e && e.message || e), true); });
      }).catch(function () {});
    } else { $('rosterNote').textContent = 'Filing is unavailable in this view'; }
  }
  if (hot && hot.ready) hot.ready(function (data) { boot(data || {}); }); else boot((hot && hot.data) || {});
})();
