/* tracker.js — the living character sheet. Owned by the tracker module. Sets window.B68Tracker.
   Everything on the printed playbook sheet becomes a live control; the whole `play` object is saved
   through api.save({ play }) on every change (immediately for clicks, debounced for typing). */
(function () {
  'use strict';
  var T = window.B68Tracker = {};
  var CT = window.B68Content || { PLAYBOOKS: [], byId: {}, ACTIONS: [], STANDARD_ITEMS: [], VICES: [] };
  var K = window.B68Figure || null;
  function B() { return window.B68 || {}; }

  /* ---------- helpers (prefer window.B68's, fall back locally) ---------- */
  function esc(s) { if (B().esc) return B().esc(s); return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function el(tag, cls, html) { if (B().el) return B().el(tag, cls, html); var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function clamp(n, a, b) { n = +n || 0; return n < a ? a : n > b ? b : n; }
  function pbOf(id) { return CT.byId[id] || null; }
  function isHull(pb) { return !!(pb && pb.hull); }
  var ACTS = []; (CT.ACTIONS || []).forEach(function (g) { g[1].forEach(function (a) { ACTS.push(a); }); });
  var ATTRS = (CT.ACTIONS || []).map(function (g) { return g[0]; });
  var MULTI = { 'Echo Pet': 2, 'Frame Upgrade': 3, 'Advanced Sparkmind': 2 };
  var AUTOMATON = ['Automaton', 'You are a soul powering a robotic body. Human-like strength and senses; built-in armor that doesn’t count for load; you start with no keys; you may be repaired if damaged or destroyed. Whenever you would take Stress, take Drain instead. Choose two frame features.'];
  var FIXED = { hull: AUTOMATON };

  var BURST = (function () { var pts = []; for (var i = 0; i < 32; i++) { var a = i * Math.PI / 16, r = i % 2 ? 11 : 15; pts.push((16 + r * Math.cos(a)).toFixed(1) + ',' + (16 + r * Math.sin(a)).toFixed(1)); } return '<svg viewBox="0 0 32 32" aria-hidden="true"><polygon points="' + pts.join(' ') + '"/></svg>'; })();
  function listText(v, sep) { return Array.isArray(v) ? v.filter(Boolean).join(sep || ', ') : String(v == null ? '' : v); }
  function keyParts(k) { var m = String(k || '').match(/^(.*?)\s*\(\s*▼\s*(.*?)\s*▲\s*(.*?)\s*\)\s*$/); return m ? { name: m[1].trim(), down: m[2].trim(), up: m[3].trim() } : { name: String(k || '').trim(), down: '', up: '' }; }
  function cohortExpert(pb) { var m = pb && pb.cohort && pb.cohort.text ? pb.cohort.text.match(/\((Expert[^)]*)\)/) : null; return m ? m[1] : ''; }

  /* ---------- the play object ---------- */
  function blankPlay() {
    var dots = {}; ACTS.forEach(function (a) { dots[a] = 0; });
    return { v: 1, crew: '', stress: 0, xp: { playbook: 0, insight: 0, prowess: 0, resolve: 0 }, dots: dots, abilities: [], abilityTicks: {}, frame: [],
      keys: [], roboticDeadlocks: [], harm: { l1: ['', ''], l2: ['', ''], l3: '', l4: '' }, healing: 0, armor: { armor: false, heavy: false }, resource: [false, false],
      stacks: 0, bank: 0, items: [], extraItems: [], loadLimit: 'quiet', cohort: { name: '', type: '', edges: '', flaws: '', abilities: '', harm: null, armor: false },
      contacts: [], vice: '', purveyor: '', clocks: [], memories: [], suspicion: 0, mastery: false, notes: '', log: [] };
  }
  function initialPlay(sheet, playbookId) {
    sheet = sheet || {}; var pb = pbOf(playbookId || sheet.playbook); var p = blankPlay();
    var d = sheet.dots || {}; ACTS.forEach(function (a) { p.dots[a] = clamp(d[a], 0, 4); });
    if (pb && pb.hull) p.abilities.push('Automaton');
    if (pb && pb.fixedAbility) p.abilities.push(pb.fixedAbility[0]);
    [sheet.ability, sheet.ability2, sheet.customAbility].forEach(function (a) { if (a && p.abilities.indexOf(a) < 0) p.abilities.push(a); });
    p.frame = (sheet.frame || []).slice();
    var keys = (sheet.keys || []).concat(sheet.customKey ? [sheet.customKey] : []);
    keys.slice(0, 4).forEach(function (k) { var ps = keyParts(k); ps.hits = 0; ps.deadlock = null; if (sheet.deadlockKey === k && sheet.deadlockMode) ps.deadlock = sheet.deadlockMode === '▲' ? 'up' : 'down'; p.keys.push(ps); });
    var sc = sheet.contacts || {};
    ((pb && pb.contacts) || []).forEach(function (c) { p.contacts.push({ name: c[0], role: c[1], kind: sc[c[0]] === 'friend' || sc[c[0]] === 'rival' ? sc[c[0]] : null }); });
    Object.keys(sc).forEach(function (n) { if (!p.contacts.some(function (c) { return c.name === n; })) p.contacts.push({ name: n, role: '', kind: sc[n] || null }); });
    if (sheet.contactCustom) p.contacts.push({ name: sheet.contactCustom, role: '', kind: /rival/i.test(sheet.contactCustom) ? 'rival' : 'friend' });
    if (!isHull(pb)) { p.vice = sheet.vice || ''; p.purveyor = sheet.purveyor || ''; }
    p.items = (sheet.items || []).slice();
    if (pb && pb.cohort) p.cohort = { name: sheet.cohortName || '', type: [sheet.cohortType, sheet.cohortHousing].filter(Boolean).join(' · '), edges: sheet.cohortEdges || '', flaws: sheet.cohortFlaws || '', abilities: cohortExpert(pb), harm: null, armor: false };
    if (isHull(pb)) p.memories = (pb.memories || []).map(function (q) { return { name: q, size: 8, filled: 0, text: '' }; });
    return p;
  }
  T.initialPlay = initialPlay;
  /* fill in anything an older or partial play is missing */
  function normalize(play, sheet, pbId) {
    var base = play && typeof play === 'object' ? clone(play) : initialPlay(sheet, pbId); var b = blankPlay();
    Object.keys(b).forEach(function (k) { if (base[k] === undefined || base[k] === null) base[k] = b[k]; });
    ACTS.forEach(function (a) { base.dots[a] = clamp(base.dots[a], 0, 4); });
    ['playbook', 'insight', 'prowess', 'resolve'].forEach(function (k) { base.xp[k] = clamp(base.xp[k], 0, k === 'playbook' ? 8 : 6); });
    if (!Array.isArray(base.contacts)) { var arr = []; Object.keys(base.contacts).forEach(function (n) { arr.push({ name: n, role: '', kind: base.contacts[n] }); }); base.contacts = arr; }
    if (!Array.isArray(base.harm.l1)) base.harm.l1 = [String(base.harm.l1 || ''), '']; if (!Array.isArray(base.harm.l2)) base.harm.l2 = [String(base.harm.l2 || ''), ''];
    var pb = pbOf(pbId); if (isHull(pb) && !base.memories.length) base.memories = (pb.memories || []).map(function (q) { return { name: q, size: 8, filled: 0, text: '' }; });
    return base;
  }

  /* ---------- paths ---------- */
  function getPath(o, path) { var ps = path.split('.'); for (var i = 0; i < ps.length; i++) { if (o == null) return undefined; o = o[ps[i]]; } return o; }
  function setPath(o, path, v) { var ps = path.split('.'); for (var i = 0; i < ps.length - 1; i++) { if (o[ps[i]] == null || typeof o[ps[i]] !== 'object') o[ps[i]] = {}; o = o[ps[i]]; } o[ps[ps.length - 1]] = v; }

  /* ---------- state ---------- */
  var cur = null; /* { doc, api, play, pb, root, ui, timer, saving } */
  var SAVE_DELAY = 400;
  function readOnly() { return !!(cur && cur.api && cur.api.canWrite === false); }
  function setStatus(msg, bad, transient) {
    if (!cur) return; var s = cur.root.querySelector('#ds-status'); if (!s) return;
    s.textContent = msg; s.className = 'ds-status' + (bad ? ' bad' : '');
    if (cur.statusT) clearTimeout(cur.statusT);
    if (transient) cur.statusT = setTimeout(function () { if (cur) setStatus(readOnly() ? 'Read only' : cur.timer || cur.saving ? 'Saving…' : 'Saved'); }, 2400);
  }
  function note(msg) { setStatus(msg, false, true); }
  function flushSave() {
    if (!cur) return; if (cur.timer) { clearTimeout(cur.timer); cur.timer = null; }
    if (readOnly()) { setStatus('Read only'); return; }
    if (!cur.api || typeof cur.api.save !== 'function') { setStatus('Not saved: no store'); return; }
    var snap = clone(cur.play); cur.saving++; setStatus('Saving…'); var p;
    try { p = cur.api.save({ play: snap }); } catch (e) { cur.saving--; setStatus('Could not save: ' + (e && e.message || e), true); return; }
    Promise.resolve(p).then(function () { if (!cur) return; cur.saving--; if (!cur.saving && !cur.timer) setStatus('Saved'); },
      function (e) { if (!cur) return; cur.saving--; setStatus('Could not save: ' + (e && e.message || e || 'unknown error'), true); });
  }
  function scheduleSave() { if (!cur) return; if (cur.timer) clearTimeout(cur.timer); setStatus('Saving…'); cur.timer = setTimeout(function () { cur.timer = null; flushSave(); }, SAVE_DELAY); }
  /* a click changed play: redraw and save at once */
  function commit() { if (!cur) return; render(); flushSave(); }

  /* ---------- small renderers ---------- */
  function box(title, body, right, cls) { return '<section class="ds-box' + (cls ? ' ' + cls : '') + '"><div class="ds-band"><span>' + title + '</span>' + (right ? '<span class="ds-band-r">' + right + '</span>' : '') + '</div><div class="ds-body">' + body + '</div></section>'; }
  function pipRow(n, filled, act, extra, cls) { var h = '<span class="ds-pips">'; for (var i = 1; i <= n; i++) h += '<button type="button" class="' + (cls || 'ds-pip') + (i <= filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + i + '"' + (extra || '') + ' aria-label="' + act + ' ' + i + '"></button>'; return h + '</span>'; }
  function clockSvg(size, filled, r, act, extra) {
    var cx = r, cy = r, R = r - 2, h = '', n = clamp(size, 2, 12);
    for (var i = 0; i < n; i++) {
      var a0 = -Math.PI / 2 + i * 2 * Math.PI / n, a1 = a0 + 2 * Math.PI / n;
      var x0 = (cx + R * Math.cos(a0)).toFixed(2), y0 = (cy + R * Math.sin(a0)).toFixed(2), x1 = (cx + R * Math.cos(a1)).toFixed(2), y1 = (cy + R * Math.sin(a1)).toFixed(2);
      var big = n === 2 ? 1 : 0;
      h += '<path class="ds-seg' + (i < filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + (i + 1) + '"' + (extra || '') + ' d="M' + cx + ' ' + cy + ' L' + x0 + ' ' + y0 + ' A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + x1 + ' ' + y1 + ' Z"><title>' + (i + 1) + ' / ' + n + '</title></path>';
    }
    return '<svg class="ds-clock" viewBox="0 0 ' + 2 * r + ' ' + 2 * r + '" width="' + 2 * r + '" height="' + 2 * r + '" role="img" aria-label="clock ' + filled + ' of ' + n + '">' + h + '<circle class="ds-clock-rim" cx="' + cx + '" cy="' + cy + '" r="' + R + '"/></svg>';
  }
  function input(path, value, ph, cls) { return '<input type="text" class="ds-in' + (cls ? ' ' + cls : '') + '" data-path="' + esc(path) + '" value="' + esc(value) + '" placeholder="' + esc(ph || '') + '">'; }
  function diamonds(n, filled, act, dis) { var h = ''; for (var i = 1; i <= n; i++) h += '<button type="button" class="ds-dia' + (i <= filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + i + '"' + (dis ? ' disabled' : '') + ' aria-label="' + act + ' ' + i + '"></button>'; return h; }
  function sq(on, act, extra) { return '<button type="button" class="ds-sq' + (on ? ' on' : '') + '" data-act="' + act + '"' + (extra || '') + '></button>'; }

  /* ---------- sections ---------- */
  function header(doc, play, pb, sheet) {
    var alt = '';
    if (isHull(pb)) alt = '<div><span class="ds-lab">Owning faction</span>' + esc(sheet.owning || '—') + (sheet.heritageDetail ? '<div class="ds-dim">' + esc(sheet.heritageDetail) + '</div>' : '') + '</div>';
    else {
      alt = '<div><span class="ds-lab">Heritage</span>' + esc(sheet.heritage || '—') + (sheet.heritageDetail ? '<div class="ds-dim">' + esc(sheet.heritageDetail) + '</div>' : '') + '</div>';
      if (pb && pb.altBackground) alt += '<div><span class="ds-lab">' + esc(pb.altBackground.label) + '</span>' + esc(listText(sheet.alt, ' · ') || '—') + (sheet.backgroundDetail ? '<div class="ds-dim">' + esc(sheet.backgroundDetail) + '</div>' : '') + '</div>';
      else alt += '<div><span class="ds-lab">Background</span>' + esc(sheet.background || '—') + (sheet.backgroundDetail ? '<div class="ds-dim">' + esc(sheet.backgroundDetail) + '</div>' : '') + '</div>';
    }
    if (pb && pb.backing) alt += '<div><span class="ds-lab">Backing faction</span>' + esc(sheet.backing || '—') + (sheet.mission ? '<div class="ds-dim">Mission: ' + esc(sheet.mission) + '</div>' : '') + '</div>';
    if (pb && pb.veteran) alt += '<div><span class="ds-lab">Damage</span>' + esc(sheet.damage || '—') + '</div><div><span class="ds-lab">Something that helps</span>' + esc(sheet.helps || '—') + '</div>';
    var ro = readOnly();
    return '<div class="ds-head">' +
      '<div class="ds-title"><div class="ds-pb">' + esc(pb ? pb.name : doc.playbookName || 'Subject') + '</div><div class="ds-desc">' + esc(pb ? pb.descriptor : '') + '</div></div>' +
      '<div class="ds-ident">' +
        '<div><span class="ds-lab">' + (isHull(pb) ? 'Designation' : 'Name') + '</span><b>' + esc(doc.name || sheet.name || 'Unknown') + '</b></div>' +
        '<div><span class="ds-lab">Alias</span>' + esc(doc.alias || sheet.alias || '—') + '</div>' +
        '<div><span class="ds-lab">Crew</span>' + input('crew', play.crew, 'Your crew') + '</div>' +
        '<div><span class="ds-lab">File</span><span class="mono">' + esc(doc.code || '') + '</span></div>' +
      '</div>' +
      '<div class="ds-nav">' +
        '<button type="button" class="btn sm" data-act="back" data-always="1">Back to files</button>' +
        '<button type="button" class="btn sm" data-act="edit"' + (ro ? ' disabled' : '') + '>Edit figure</button>' +
        '<button type="button" class="btn sm ds-remove" data-act="remove"' + (ro ? ' disabled' : '') + '>' + (cur.ui.confirmRemove ? 'Click again to remove' : 'Remove') + '</button>' +
        '<span class="ds-status" id="ds-status">' + (ro ? 'Read only' : 'Saved') + '</span>' +
      '</div>' +
      '<div class="ds-bio">' +
        '<div><span class="ds-lab">Look</span>' + esc(sheet.look || '—') + '</div>' +
        '<div><span class="ds-lab">Wearing</span>' + esc(listText(sheet.wearing) || '—') + '</div>' + alt +
      '</div>' +
    '</div>';
  }
  function figure(doc) {
    var svg = '', warn = '';
    try { if (K && doc.spec) { var r = cur.ui.mug ? K.portrait(doc.spec) : K.render(doc.spec, { height: 420 }); svg = r && r.svg || ''; } } catch (e) { warn = 'The kit could not draw this figure: ' + e.message; }
    return box('Figure', '<div class="ds-art' + (cur.ui.mug ? ' mug' : '') + '">' + (svg || '<div class="ds-dim">' + esc(warn || 'No figure on file.') + '</div>') + '</div>',
      '<span class="seg"><button type="button" class="chip sm" data-act="view" data-v="fig" data-always="1" aria-pressed="' + (!cur.ui.mug) + '">Figure</button><button type="button" class="chip sm" data-act="view" data-v="mug" data-always="1" aria-pressed="' + (!!cur.ui.mug) + '">Mugshot</button></span>', 'ds-figbox');
  }
  function stress(play, pb) {
    var hull = isHull(pb), n = hull ? 10 : 9;
    var h = '<div class="ds-stress">' + pipRow(n, play.stress, 'stress', '', 'ds-sbox') + '<span class="mono ds-count">' + play.stress + ' / ' + n + '</span></div>';
    h += '<div class="row ds-tools">' +
      (hull ? '<button type="button" class="btn sm" data-act="stressd" data-d="-5">Recharge −5</button>' : '<button type="button" class="btn sm" data-act="stressd" data-d="-1">Indulge −1</button><button type="button" class="btn sm" data-act="stressd" data-d="-3">Indulge −3</button>') +
      '<span class="ds-gap"></span><button type="button" class="btn sm" data-act="stressd" data-d="1">Mark +1</button><button type="button" class="btn sm" data-act="stressd" data-d="2">Mark +2</button></div>';
    if (hull) h += '<p class="hint">Whenever you would take Stress, take Drain. At your last Drain box you go On Program immediately and deadlock a key (or mark a robotic deadlock).</p>';
    else if (play.stress >= n) h += '<p class="hint ds-warn">Stress is full: trauma. Deadlock a key.</p>';
    return box(hull ? 'Drain' : 'Stress', h, hull ? '' : '');
  }
  function keys(play, pb) {
    var hull = isHull(pb), h = '';
    if (hull) h += '<p class="hint">You start with no keys; memories can restore them. If you have no keys when you would deadlock, mark a robotic deadlock instead.</p>';
    play.keys.forEach(function (k, i) {
      var dl = k.deadlock;
      h += '<div class="ds-key' + (dl ? ' locked' : '') + '">' +
        '<div class="ds-key-main">' + input('keys.' + i + '.name', k.name, 'Key', 'ds-key-name') +
          '<span class="ds-key-dl"><span class="ds-arrow">▼</span>' + input('keys.' + i + '.down', k.down, 'reversed', 'ds-key-word') + '<span class="ds-arrow">▲</span>' + input('keys.' + i + '.up', k.up, 'intensified', 'ds-key-word') + '</span></div>' +
        '<div class="ds-key-side">' + pipRow(3, k.hits, 'keyhit', ' data-i="' + i + '"') +
          (dl ? '<span class="ds-burst on" title="Permanent — hard mode">' + (dl === 'up' ? '▲ ' + esc(k.up || 'intensified') : '▼ ' + esc(k.down || 'reversed')) + '</span><span class="ds-perm">Permanent — hard mode</span><button type="button" class="ds-x" data-act="undeadlock" data-i="' + i + '" title="Undo deadlock (GM)">undo (GM)</button>'
             : '<span class="ds-burstgrp"><button type="button" class="ds-burst" data-act="deadlock" data-i="' + i + '" data-dir="down" title="Deadlock: reversed">' + BURST + '<span>▼</span></button><button type="button" class="ds-burst" data-act="deadlock" data-i="' + i + '" data-dir="up" title="Deadlock: intensified">' + BURST + '<span>▲</span></button></span>') +
          '<button type="button" class="ds-x" data-act="rmkey" data-i="' + i + '" title="Remove key">×</button>' +
        '</div></div>';
    });
    if (play.keys.length < 4) {
      var opts = '<option value="">Add a key…</option>'; ((pb && pb.keys) || []).forEach(function (k) { if (!play.keys.some(function (x) { return x.name === keyParts(k).name; })) opts += '<option value="' + esc(k) + '">' + esc(k) + '</option>'; });
      opts += '<option value="*">Write your own</option>';
      h += '<div class="row ds-addrow"><select class="ds-sel" data-change="addkey">' + opts + '</select></div>';
    }
    if (hull) {
      h += '<div class="ds-lab" style="margin-top:8px">Robotic deadlocks</div><div class="row">';
      (pb.roboticDeadlocks || []).forEach(function (r) { h += '<button type="button" class="chip sm" data-act="robo" data-v="' + esc(r) + '" aria-pressed="' + (play.roboticDeadlocks.indexOf(r) >= 0) + '">' + esc(r) + '</button>'; });
      h += '</div>';
    }
    return box('Keys', h, '<span class="ds-dlhead">Deadlocks</span>');
  }
  function harm(play, pb) {
    var hull = isHull(pb), hm = play.harm, pbr = pb && pb.resource && !hull ? pb.resource : null;
    var h = '<div class="ds-harm">' +
      '<div class="ds-hrow"><span class="ds-hl">4. ' + (hull ? 'Destroyed' : 'Mortal') + '</span>' + input('harm.l4', hm.l4, '', 'ds-hin') + '</div>' +
      '<div class="ds-hrow"><span class="ds-hl">3. Critical</span>' + input('harm.l3', hm.l3, '', 'ds-hin') + '</div>' +
      '<div class="ds-hrow two"><span class="ds-hl">2. Major</span>' + input('harm.l2.0', hm.l2[0], '', 'ds-hin') + '<span class="ds-hl">2. Major</span>' + input('harm.l2.1', hm.l2[1], '', 'ds-hin') + '</div>' +
      '<div class="ds-hrow two"><span class="ds-hl">1. Passing</span>' + input('harm.l1.0', hm.l1[0], '', 'ds-hin') + '<span class="ds-hl">1. Passing</span>' + input('harm.l1.1', hm.l1[1], '', 'ds-hin') + '</div>' +
    '</div>';
    var side = '<div class="ds-side"><div class="ds-heal"><span class="ds-lab">' + (hull ? 'Repair' : 'Healing') + '</span>' + clockSvg(4, play.healing, 22, 'heal') + '</div>' +
      '<div class="ds-res"><span class="ds-lab">Resources</span>' +
        '<div class="ds-resrow"><span>Armor</span><span class="ds-boxes">' + sq(play.armor.armor, 'armor', ' data-k="armor"') + '</span></div>' +
        '<div class="ds-resrow"><span>Heavy</span><span class="ds-boxes">' + sq(play.armor.heavy, 'armor', ' data-k="heavy"') + '</span></div>' +
        (pbr ? '<div class="ds-resrow"><span>' + esc(pbr.charAt(0).toUpperCase() + pbr.slice(1)) + '</span><span class="ds-boxes">' + sq(play.resource[0], 'resource', ' data-k="0"') + sq(play.resource[1], 'resource', ' data-k="1"') + '</span></div>' : '') +
        (hull ? '<div class="ds-dim">Built-in frame armor; it never counts for load.</div>' : '') +
      '</div></div>';
    return box(hull ? 'Damage' : 'Harm', '<div class="ds-harmgrid">' + h + side + '</div>');
  }
  function cohort(play, pb) {
    if (!pb || !pb.cohort) return '';
    var c = play.cohort, h = '<div class="ds-cohort">' +
      '<div class="ds-corow"><div><span class="ds-lab">Name</span>' + input('cohort.name', c.name, 'Name') + '</div><div><span class="ds-lab">Type</span>' + input('cohort.type', c.type, (pb.cohort.types || []).slice(0, 3).join(', ')) + '</div></div>' +
      '<div class="ds-corow"><div><span class="ds-lab">Edges</span>' + input('cohort.edges', c.edges, 'e.g. Fearless, Loyal') + '</div><div><span class="ds-lab">Flaws</span>' + input('cohort.flaws', c.flaws, 'e.g. Wild, Savage') + '</div></div>' +
      '<div><span class="ds-lab">Abilities</span>' + input('cohort.abilities', c.abilities, cohortExpert(pb)) + '</div>' +
      '<div class="row ds-cohs">' + ['weak', 'impaired', 'broken'].map(function (s) { return '<button type="button" class="ds-coh' + (c.harm === s ? ' on' : '') + '" data-act="coharm" data-v="' + s + '"><span class="ds-cohpip"></span>' + s.charAt(0).toUpperCase() + s.slice(1) + '</button>'; }).join('') +
        '<button type="button" class="ds-coh' + (c.armor ? ' on' : '') + '" data-act="coarmor"><span class="ds-cohsq"></span>Armor</button></div>' +
    '</div>';
    return box(esc(pb.cohort.label), h, '<span class="ds-dim">Cohort (' + esc(cohortExpert(pb) || 'Expert') + ')</span>');
  }
  function abilities(play, pb, sheet) {
    var hull = isHull(pb), list = [], h = '';
    if (pb) { if (hull) list.push({ n: AUTOMATON[0], t: AUTOMATON[1], fixed: true }); if (pb.fixedAbility) list.push({ n: pb.fixedAbility[0], t: pb.fixedAbility[1], fixed: true }); pb.abilities.forEach(function (a) { list.push({ n: a[0], t: a[1] }); }); }
    var names = list.map(function (a) { return a.n; });
    list.forEach(function (a) {
      var max = MULTI[a.n] || 1, owned = play.abilities.indexOf(a.n) >= 0, ticks = owned ? Math.max(1, play.abilityTicks[a.n] || 1) : 0;
      var circles = '';
      for (var i = 1; i <= max; i++) circles += '<button type="button" class="ds-circ' + (i <= ticks ? ' on' : '') + (a.fixed ? ' fixed' : '') + '" data-act="ability" data-n="' + esc(a.n) + '" data-i="' + i + '"' + (a.fixed ? ' disabled' : '') + ' aria-label="' + esc(a.n) + ' ' + i + '"></button>';
      h += '<div class="ds-ab' + (owned ? ' on' : '') + '"><span class="ds-circs">' + circles + '</span><div><b>' + esc(a.n) + ':</b> ' + esc(a.t) + '</div></div>';
    });
    var customs = play.abilities.filter(function (n) { return names.indexOf(n) < 0; });
    var vc = ''; for (var i = 1; i <= 3; i++) vc += '<span class="ds-circ' + (i <= customs.length ? ' on' : '') + ' fixed"></span>';
    h += '<div class="ds-ab' + (customs.length ? ' on' : '') + '"><span class="ds-circs">' + vc + '</span><div><b>Versatile:</b> Choose a special ability from another source.' +
      customs.map(function (n) { return '<div class="ds-custom">' + esc(n) + ' <button type="button" class="ds-x" data-act="rmability" data-n="' + esc(n) + '" title="Remove">×</button></div>'; }).join('') +
      '<div class="row ds-addrow">' + input('', '', 'Name and rule text from another playbook', 'ds-grow ds-newab') + '<button type="button" class="btn sm" data-act="addability">Add</button></div></div></div>';
    if (hull) {
      h += '<div class="ds-lab ds-sub">Frame features</div><div class="ds-frame">';
      (pb.frame || []).forEach(function (f) { var on = play.frame.indexOf(f[0]) >= 0; h += '<button type="button" class="ds-feat' + (on ? ' on' : '') + '" data-act="frame" data-n="' + esc(f[0]) + '" aria-pressed="' + on + '"><span class="ds-sq' + (on ? ' on' : '') + '"></span><span><b>' + esc(f[0]) + '</b> <span class="ds-dim">' + esc(f[1]) + '</span></span></button>'; });
      h += '</div>';
    }
    return box(hull ? 'Hull traits' : 'Special abilities', h, '<span class="ds-xpmini">xp ' + pipRow(8, play.xp.playbook, 'xp', ' data-k="playbook"', 'ds-xbox') + '</span>');
  }
  function triggers(play, pb) {
    var hull = isHull(pb);
    var h = '<ul class="ds-trig">' +
      '<li>Every time you roll a <b>desperate action</b> or a <b>zero-dot action</b>, mark xp in any attribute of your choice.</li>' +
      '<li>Once per session when you <b>hit a key</b>, mark 1 xp and mark the key.</li>' +
      '<li class="ds-trig-h">At the end of each session, mark 1 xp (or 2 xp if you really smashed it) if:</li>' +
      '<li>You ' + (pb ? esc(pb.xp.replace(/^address/, 'addressed').replace(/^obey orders, or address/, 'obeyed orders, or addressed')) : 'addressed a challenge in your playbook’s way') + '.</li>' +
      '<li>You struggled with issues stemming from a <b>deadlock</b>.</li></ul>';
    if (hull) h += '<p class="hint">Whenever you would mark playbook xp, you can tick a memory clock instead. When all four memories are complete, the first trigger becomes: you worked to free yourself from your owning faction and controller, or addressed a challenge with your humanity.</p>';
    var full = play.xp.playbook >= 8;
    h += '<div class="row ds-tools"><span class="ds-lab">Playbook xp</span>' + pipRow(8, play.xp.playbook, 'xp', ' data-k="playbook"', 'ds-xbox') + '<span class="mono ds-count">' + play.xp.playbook + ' / 8</span></div>' +
      (full ? '<p class="hint ds-warn">Playbook track full: pick a new special ability above (8 xp are spent when you do).</p>' : '');
    return box('XP', h);
  }
  function actions(play, pb) {
    var h = '<div class="ds-attrs">';
    (CT.ACTIONS || []).forEach(function (g) {
      var attr = g[0], key = attr.toLowerCase(), rating = g[1].filter(function (a) { return (play.dots[a] || 0) > 0; }).length, xp = play.xp[key] || 0;
      h += '<div class="ds-attr"><div class="ds-attr-h"><span class="ds-attr-n">' + esc(attr) + '</span><span class="ds-rating mono">' + rating + '</span><span class="ds-xpmini">xp ' + pipRow(6, xp, 'xp', ' data-k="' + key + '"', 'ds-xbox') + '</span></div>';
      if (xp >= 6) {
        if (cur.ui.advance === key) h += '<div class="ds-advance"><span class="ds-lab">Add a dot to</span>' + g[1].map(function (a) { var v = play.dots[a] || 0, max = play.mastery ? 4 : 3; return '<button type="button" class="chip sm" data-act="advdot" data-k="' + key + '" data-a="' + esc(a) + '"' + (v >= max ? ' disabled' : '') + '>' + esc(a) + ' ' + v + '→' + (v + 1) + '</button>'; }).join('') + '<button type="button" class="chip sm none" data-act="advcancel">Later</button></div>';
        else h += '<div class="ds-advance"><button type="button" class="btn sm primary" data-act="advance" data-k="' + key + '">Advance: +1 dot</button></div>';
      }
      g[1].forEach(function (a) {
        var v = play.dots[a] || 0, pr = pb && pb.printed ? (pb.printed[a] || 0) : 0, pips = '';
        for (var i = 1; i <= 4; i++) pips += '<button type="button" class="ds-pip' + (i <= v ? ' on' : '') + (i <= pr ? ' printed' : '') + (i === 4 ? ' mastery' : '') + '" data-act="dot" data-a="' + esc(a) + '" data-n="' + i + '"' + (i === 4 && !play.mastery ? ' disabled' : '') + ' aria-label="' + esc(a) + ' ' + i + '"></button>';
        h += '<div class="ds-act"><span class="ds-pips">' + pips + '</span><span class="ds-act-n">' + esc(a) + '</span></div>';
      });
      h += '</div>';
    });
    h += '</div><div class="row ds-tools"><label class="ds-check"><input type="checkbox" data-change="mastery"' + (play.mastery ? ' checked' : '') + '> Mastery (crew upgrade: ratings up to 4)</label></div>';
    return box('Actions', h, '<span class="ds-dim">attribute = actions rated 1+</span>');
  }
  function stacks(play, pb) {
    var hull = isHull(pb), canBank = !hull || play.abilities.indexOf('A Room of Your Own') >= 0;
    var h = '<div class="ds-stackrow"><span class="ds-lab">Stacks</span><span class="ds-dias">' + diamonds(4, play.stacks, 'stacks') + '</span><span class="mono ds-count">' + play.stacks + '</span></div>' +
      '<div class="ds-bank"><span class="ds-lab">Bank' + (hull ? ' <span class="ds-dim">*requires A Room of Your Own</span>' : '') + '</span>';
    for (var r = 0; r < 4; r++) { h += '<span class="ds-dias">'; for (var i = 1; i <= 10; i++) { var n = r * 10 + i; h += '<button type="button" class="ds-dia' + (n <= play.bank ? ' on' : '') + '" data-act="bank" data-n="' + n + '"' + (canBank ? '' : ' disabled') + ' aria-label="bank ' + n + '"></button>'; } h += '</span>'; }
    h += '<span class="mono ds-count">' + play.bank + ' / 40</span></div>';
    if (!canBank) h += '<p class="hint">Hulls cannot put stacks into bank without the trait A Room of Your Own.</p>';
    h += '<div class="row ds-tools"><button type="button" class="btn sm" data-act="tobank" data-n="1"' + (canBank && play.stacks > 0 && play.bank < 40 ? '' : ' disabled') + '>Bank a stack</button><button type="button" class="btn sm" data-act="frombank" data-n="1"' + (play.bank > 0 && play.stacks < 4 ? '' : ' disabled') + '>Draw a stack</button></div>';
    return box('Stacks & bank', h);
  }
  function itemLoad(play, pb, name) { var all = ((pb && pb.items) || []).concat(CT.STANDARD_ITEMS || [], (play.extraItems || []).map(function (x) { return [x.name, x.load]; })); var it = all.filter(function (i) { return i[0] === name; })[0]; return it ? +it[1] || 0 : 0; }
  function loadBonus(play) { var b = 0; if (play.abilities.indexOf('Walking Arsenal') >= 0) b += 2; if (play.abilities.indexOf('Retractable Arsenal') >= 0) b += 2; return b; }
  function items(play, pb) {
    var hull = isHull(pb);
    var carried = play.items.reduce(function (t, n) { return t + itemLoad(play, pb, n); }, 0), total = carried + play.stacks;
    var limit = (play.loadLimit === 'loud' ? 6 : 3) + loadBonus(play), over = total > limit;
    function row(it, extra) { var on = play.items.indexOf(it[0]) >= 0, l = +it[1] || 0, lb = ''; for (var i = 0; i < l; i++) lb += '<span class="ds-ld"></span>'; return '<button type="button" class="ds-item' + (on ? ' on' : '') + '" data-act="item" data-n="' + esc(it[0]) + '" aria-pressed="' + on + '"><span class="ds-sq' + (on ? ' on' : '') + '"></span><span class="ds-item-n">' + esc(it[0]) + '</span><span class="ds-lds">' + (l ? lb : '<span class="ds-dim">0</span>') + '</span></button>' + (extra || ''); }
    var h = '<div class="ds-loadhead"><span class="seg"><button type="button" class="chip sm" data-act="limit" data-v="quiet" aria-pressed="' + (play.loadLimit !== 'loud') + '">◇ ' + (3 + loadBonus(play)) + ' quiet</button><button type="button" class="chip sm" data-act="limit" data-v="loud" aria-pressed="' + (play.loadLimit === 'loud') + '">◆ ' + (6 + loadBonus(play)) + ' loud</button></span>' +
      '<span class="budget' + (over ? ' bad' : '') + '">' + total + ' / ' + limit + ' load</span></div>' +
      '<p class="hint">' + carried + ' from items' + (play.stacks ? ' + ' + play.stacks + ' from stacks carried' : '') + (hull ? '. Frame armor is free.' : '. A carried stack takes a load slot.') + '</p>';
    h += '<div class="ds-items ds-pbitems">' + ((pb && pb.items) || []).map(function (it) { return row(it); }).join('') + '</div>';
    h += '<div class="ds-items">' + (CT.STANDARD_ITEMS || []).map(function (it) { return row(it); }).join('') + '</div>';
    if (play.extraItems.length) h += '<div class="ds-items">' + play.extraItems.map(function (x) { return row([x.name, x.load], '<button type="button" class="ds-x" data-act="rmitem" data-n="' + esc(x.name) + '" title="Remove">×</button>'); }).join('') + '</div>';
    h += '<div class="row ds-addrow">' + input('', '', 'Another item', 'ds-grow ds-newitem') + '<input type="number" class="ds-in ds-num ds-newload" min="0" max="6" value="1" aria-label="load"><button type="button" class="btn sm" data-act="additem">Add</button></div>';
    return box('Items', h);
  }
  function contacts(play, pb) {
    var h = '<div class="ds-contacts">';
    play.contacts.forEach(function (c, i) {
      h += '<div class="ds-contact"><button type="button" class="ds-cdot' + (c.kind ? ' ' + c.kind : '') + '" data-act="contact" data-i="' + i + '" title="' + (c.kind === 'friend' ? '▲ friend' : c.kind === 'rival' ? '▼ rival' : 'neither') + '">' + (c.kind === 'friend' ? '▲' : c.kind === 'rival' ? '▼' : '△') + '</button>' +
        '<span class="ds-cname">' + esc(c.name) + (c.role ? ', <span class="ds-dim">' + esc(c.role) + '</span>' : '') + '</span><span class="ds-cst">' + (c.kind === 'friend' ? 'friend' : c.kind === 'rival' ? 'rival' : '') + '</span>' +
        '<button type="button" class="ds-x" data-act="rmcontact" data-i="' + i + '" title="Remove">×</button></div>';
    });
    h += '</div><div class="row ds-addrow">' + input('', '', 'Name', 'ds-grow ds-newcname') + input('', '', 'what they do', 'ds-grow ds-newcrole') + '<button type="button" class="btn sm" data-act="addcontact">Add</button></div>';
    var title = isHull(pb) ? 'Contacts' : pb && pb.id === 'hound' ? 'Shady friends' : pb && pb.id === 'intellectual' ? 'Brilliant friends' : pb && pb.veteran ? 'Difficult friends' : 'Friends & rivals';
    return box(title, h, '<span class="ds-dim">click the mark to cycle</span>');
  }
  function vice(play, pb) {
    if (isHull(pb)) return '';
    var opts = '<option value="">—</option>'; (CT.VICES || []).forEach(function (v) { opts += '<option value="' + esc(v.name) + '"' + (play.vice === v.name ? ' selected' : '') + '>' + esc(v.name) + '</option>'; });
    if (play.vice && !(CT.VICES || []).some(function (v) { return v.name === play.vice; })) opts += '<option value="' + esc(play.vice) + '" selected>' + esc(play.vice) + '</option>';
    return box('Vice / hookup', '<div class="ds-vice"><select class="ds-sel" data-change="vice">' + opts + '</select>' + input('purveyor', play.purveyor, 'Purveyor: name, place, district') + '</div>');
  }
  function clocks(play, pb) {
    var h = '<div class="ds-clocks">';
    play.clocks.forEach(function (c, i) {
      h += '<div class="ds-clockrow">' + clockSvg(c.size, c.filled, 26, 'clock', ' data-i="' + i + '"') + '<div class="ds-clockmeta">' + input('clocks.' + i + '.name', c.name, 'What is this clock for?') + '<span class="ds-dim mono">' + c.filled + ' / ' + c.size + '</span></div><button type="button" class="ds-x" data-act="rmclock" data-i="' + i + '" title="Remove">×</button></div>';
    });
    if (!play.clocks.length) h += '<p class="hint">Long-term projects, healing, the GM’s dangers: add a clock and click its segments.</p>';
    h += '</div><div class="row ds-addrow">' + input('', '', 'New clock', 'ds-grow ds-newclock') + '<span class="seg">' + [4, 6, 8].map(function (n) { return '<button type="button" class="chip sm" data-act="addclock" data-n="' + n + '">' + n + '</button>'; }).join('') + '</span></div>';
    return box('Clocks', h);
  }
  function memories(play, pb) {
    if (!isHull(pb)) return '';
    var h = '<p class="hint">Whenever you would mark playbook xp, you can tick a memory clock instead. When the clock is full, fill in the memory: you also remember one key, a human contact, and a special ability from another playbook.</p><div class="ds-mems">';
    play.memories.forEach(function (m, i) {
      h += '<div class="ds-mem' + (m.filled >= m.size ? ' full' : '') + '"><div class="ds-mem-h"><b>' + esc(m.name) + '</b>' + clockSvg(m.size || 8, m.filled, 22, 'memory', ' data-i="' + i + '"') + '</div>' + input('memories.' + i + '.text', m.text || '', m.filled >= (m.size || 8) ? 'Write the memory' : 'Fill the clock, then write the memory') + '</div>';
    });
    h += '</div><div class="ds-susp"><span class="ds-lab">Suspicion</span>' + clockSvg(4, play.suspicion, 22, 'suspicion') + '<span class="hint">Each downtime you skip going On Program, tick it. When full, your owning faction takes steps.</span></div>';
    return box('Human memories', h);
  }
  function notes(play) { return box('Notes', '<textarea class="ds-ta" data-path="notes" placeholder="Anything the sheet has no box for">' + esc(play.notes) + '</textarea>'); }
  function log(play) {
    var h = '<div class="row ds-addrow">' + input('', '', 'What happened this session?', 'ds-grow ds-newlog') + '<button type="button" class="btn sm" data-act="log">Log</button></div><ol class="ds-log">';
    (play.log || []).forEach(function (e, i) { var d = ''; try { d = new Date(e.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (x) { d = String(e.at || '').slice(0, 10); } h += '<li><span class="mono ds-logd">' + esc(d) + '</span><span class="ds-logt">' + esc(e.text) + '</span><button type="button" class="ds-x" data-act="rmlog" data-i="' + i + '" title="Remove">×</button></li>'; });
    h += '</ol>' + (!(play.log || []).length ? '<p class="hint">Nothing logged yet.</p>' : '');
    return box('Session log', h, '<span class="ds-dim">newest first</span>');
  }

  /* ---------- render ---------- */
  function render() {
    if (!cur) return; var doc = cur.doc, play = cur.play, pb = cur.pb, sheet = doc.sheet || {};
    var focus = captureFocus();
    var html = header(doc, play, pb, sheet) +
      '<div class="ds-grid">' +
        '<div class="ds-col ds-c1">' + figure(doc) + stress(play, pb) + keys(play, pb) + harm(play, pb) + cohort(play, pb) + vice(play, pb) + '</div>' +
        '<div class="ds-col ds-c2">' + abilities(play, pb, sheet) + contacts(play, pb) + triggers(play, pb) + memories(play, pb) + '</div>' +
        '<div class="ds-col ds-c3">' + stacks(play, pb) + actions(play, pb) + items(play, pb) + '</div>' +
        '<div class="ds-col ds-c4">' + clocks(play, pb) + notes(play) + log(play) + '</div>' +
      '</div>';
    cur.root.innerHTML = html;
    cur.root.className = 'dossier ds' + (readOnly() ? ' ds-ro' : '');
    if (readOnly()) cur.root.querySelectorAll('button, input, textarea, select').forEach(function (n) { if (!n.dataset.always) n.disabled = true; });
    restoreFocus(focus);
  }
  function captureFocus() {
    if (!cur) return null; var a = document.activeElement; if (!a || !cur.root.contains(a)) return null;
    var tag = a.tagName; if (tag !== 'INPUT' && tag !== 'TEXTAREA') return null;
    return { path: a.dataset.path || null, cls: a.className, value: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  function restoreFocus(f) {
    if (!f || !cur) return; var n = null;
    if (f.path) n = cur.root.querySelector('[data-path="' + f.path.replace(/"/g, '\\"') + '"]');
    else { var cls = f.cls.split(' ').filter(function (c) { return /^ds-new/.test(c); })[0]; if (cls) n = cur.root.querySelector('.' + cls); }
    if (!n) return; if (!f.path) n.value = f.value;
    try { n.focus({ preventScroll: true }); if (f.s != null) n.setSelectionRange(f.s, f.e); } catch (e) {}
  }

  /* ---------- actions ---------- */
  function toggleTrack(curV, n) { return curV === n ? n - 1 : n; }
  function spendForAbility(name, what) {
    var p = cur.play;
    if (p.xp.playbook >= 8) { if (!window.confirm('Spend 8 playbook xp on ' + what + '?')) return false; p.xp.playbook -= 8; note('8 xp spent on ' + name); return true; }
    return window.confirm('You have ' + p.xp.playbook + ' / 8 playbook xp. Add ' + what + ' anyway (GM)?');
  }
  var ACTIONS = {
    back: function () { if (cur.api && cur.api.back) cur.api.back(); },
    edit: function () { if (cur.api && cur.api.edit) cur.api.edit(); },
    remove: function () {
      if (!cur.ui.confirmRemove) { cur.ui.confirmRemove = true; render(); if (cur.rmT) clearTimeout(cur.rmT); cur.rmT = setTimeout(function () { if (cur) { cur.ui.confirmRemove = false; render(); } }, 4000); return; }
      cur.ui.confirmRemove = false; if (cur.rmT) clearTimeout(cur.rmT);
      var p; try { p = cur.api && cur.api.remove ? cur.api.remove() : null; } catch (e) { setStatus('Could not remove: ' + e.message, true); return; }
      setStatus('Removing…'); Promise.resolve(p).then(null, function (e) { if (cur) setStatus('Could not remove: ' + (e && e.message || e), true); });
    },
    view: function (d) { cur.ui.mug = d.v === 'mug'; render(); },
    stress: function (d) { cur.play.stress = toggleTrack(cur.play.stress, +d.n); commit(); },
    stressd: function (d) { cur.play.stress = clamp(cur.play.stress + (+d.d), 0, isHull(cur.pb) ? 10 : 9); commit(); },
    keyhit: function (d) { var k = cur.play.keys[+d.i]; if (!k) return; var n = +d.n; if (n > (k.hits || 0)) { k.hits = n; if (cur.play.xp.playbook < 8) { cur.play.xp.playbook++; note('Key hit: +1 playbook xp'); } } else k.hits = n - 1; commit(); },
    deadlock: function (d) { var k = cur.play.keys[+d.i]; if (!k) return; var word = d.dir === 'up' ? k.up : k.down; if (!window.confirm('Deadlock ' + (k.name || 'this key') + ' as ' + (d.dir === 'up' ? '▲ ' : '▼ ') + (word || d.dir) + '? Hard mode: this is permanent.')) return; k.deadlock = d.dir; commit(); },
    undeadlock: function (d) { var k = cur.play.keys[+d.i]; if (!k) return; if (!window.confirm('GM override: clear the permanent deadlock on ' + (k.name || 'this key') + '?')) return; k.deadlock = null; commit(); },
    rmkey: function (d) { var k = cur.play.keys[+d.i]; if (!k) return; if (k.deadlock && !window.confirm('This key is deadlocked. Remove it anyway?')) return; if (!k.deadlock && (k.name || k.hits) && !window.confirm('Remove the key ' + (k.name || '') + '?')) return; cur.play.keys.splice(+d.i, 1); commit(); },
    robo: function (d) { var a = cur.play.roboticDeadlocks, i = a.indexOf(d.v); if (i >= 0) { if (!window.confirm('GM override: clear the robotic deadlock ' + d.v + '?')) return; a.splice(i, 1); } else { if (!window.confirm('Mark the robotic deadlock ' + d.v + '? Hard mode: this is permanent.')) return; a.push(d.v); } commit(); },
    heal: function (d) { cur.play.healing = toggleTrack(cur.play.healing, +d.n); commit(); },
    armor: function (d) { cur.play.armor[d.k] = !cur.play.armor[d.k]; commit(); },
    resource: function (d) { cur.play.resource[+d.k] = !cur.play.resource[+d.k]; commit(); },
    coharm: function (d) { cur.play.cohort.harm = cur.play.cohort.harm === d.v ? null : d.v; commit(); },
    coarmor: function () { cur.play.cohort.armor = !cur.play.cohort.armor; commit(); },
    ability: function (d) {
      var p = cur.play, name = d.n, i = +d.i, max = MULTI[name] || 1, owned = p.abilities.indexOf(name) >= 0, ticks = owned ? Math.max(1, p.abilityTicks[name] || 1) : 0;
      if (i === ticks + 1) { if (!spendForAbility(name, ticks ? 'another circle of ' + name : name)) return; if (!owned) p.abilities.push(name); if (max > 1) p.abilityTicks[name] = ticks + 1; commit(); }
      else if (i === ticks) { if (!window.confirm(ticks > 1 ? 'Remove a circle from ' + name + '? (GM)' : 'Remove ' + name + '? (GM)')) return; if (ticks > 1) p.abilityTicks[name] = ticks - 1; else { p.abilities.splice(p.abilities.indexOf(name), 1); delete p.abilityTicks[name]; } commit(); }
    },
    addability: function (d, n) { var inp = cur.root.querySelector('.ds-newab'); var v = inp && inp.value.trim(); if (!v) { if (inp) inp.focus(); return; } if (cur.play.abilities.indexOf(v) >= 0) return; if (!spendForAbility(v, 'the ability “' + v + '”')) return; cur.play.abilities.push(v); commit(); },
    rmability: function (d) { if (!window.confirm('Remove ' + d.n + '?')) return; var i = cur.play.abilities.indexOf(d.n); if (i >= 0) cur.play.abilities.splice(i, 1); commit(); },
    frame: function (d) { var a = cur.play.frame, i = a.indexOf(d.n); if (i >= 0) { if (!window.confirm('Remove the frame feature ' + d.n + '?')) return; a.splice(i, 1); } else { if (!window.confirm('Add the frame feature ' + d.n + '? (Frame Upgrade grants two.)')) return; a.push(d.n); } commit(); },
    xp: function (d) { var k = d.k, max = k === 'playbook' ? 8 : 6; cur.play.xp[k] = clamp(toggleTrack(cur.play.xp[k], +d.n), 0, max); if (cur.ui.advance === k && cur.play.xp[k] < 6) cur.ui.advance = null; commit(); },
    advance: function (d) { cur.ui.advance = d.k; render(); },
    advcancel: function () { cur.ui.advance = null; render(); },
    advdot: function (d) { var max = cur.play.mastery ? 4 : 3; if ((cur.play.dots[d.a] || 0) >= max) return; cur.play.dots[d.a] = (cur.play.dots[d.a] || 0) + 1; cur.play.xp[d.k] = 0; cur.ui.advance = null; note(d.a + ' is now ' + cur.play.dots[d.a]); commit(); },
    dot: function (d) { var n = +d.n, max = cur.play.mastery ? 4 : 3; if (n > max) return; cur.play.dots[d.a] = toggleTrack(cur.play.dots[d.a] || 0, n); commit(); },
    stacks: function (d) { cur.play.stacks = toggleTrack(cur.play.stacks, +d.n); commit(); },
    bank: function (d) { cur.play.bank = toggleTrack(cur.play.bank, +d.n); commit(); },
    tobank: function () { if (cur.play.stacks > 0 && cur.play.bank < 40) { cur.play.stacks--; cur.play.bank++; commit(); } },
    frombank: function () { if (cur.play.bank > 0 && cur.play.stacks < 4) { cur.play.bank--; cur.play.stacks++; commit(); } },
    item: function (d) { var a = cur.play.items, i = a.indexOf(d.n); if (i >= 0) a.splice(i, 1); else a.push(d.n); commit(); },
    limit: function (d) { cur.play.loadLimit = d.v === 'loud' ? 'loud' : 'quiet'; commit(); },
    additem: function () { var ni = cur.root.querySelector('.ds-newitem'), nl = cur.root.querySelector('.ds-newload'); var v = ni && ni.value.trim(); if (!v) { if (ni) ni.focus(); return; } if (itemLoad(cur.play, cur.pb, v) || (cur.pb && cur.pb.items.concat(CT.STANDARD_ITEMS).some(function (x) { return x[0] === v; }))) { note('That item is already on the list'); return; } cur.play.extraItems.push({ name: v, load: clamp(nl ? nl.value : 1, 0, 6) }); if (cur.play.items.indexOf(v) < 0) cur.play.items.push(v); commit(); },
    rmitem: function (d) { cur.play.extraItems = cur.play.extraItems.filter(function (x) { return x.name !== d.n; }); var i = cur.play.items.indexOf(d.n); if (i >= 0) cur.play.items.splice(i, 1); commit(); },
    contact: function (d) { var c = cur.play.contacts[+d.i]; if (!c) return; c.kind = !c.kind ? 'friend' : c.kind === 'friend' ? 'rival' : null; commit(); },
    rmcontact: function (d) { var c = cur.play.contacts[+d.i]; if (!c) return; if (!window.confirm('Remove ' + c.name + '?')) return; cur.play.contacts.splice(+d.i, 1); commit(); },
    addcontact: function () { var n = cur.root.querySelector('.ds-newcname'), r = cur.root.querySelector('.ds-newcrole'); var v = n && n.value.trim(); if (!v) { if (n) n.focus(); return; } cur.play.contacts.push({ name: v, role: r ? r.value.trim() : '', kind: 'friend' }); commit(); },
    clock: function (d) { var c = cur.play.clocks[+d.i]; if (!c) return; c.filled = toggleTrack(c.filled, +d.n); commit(); },
    rmclock: function (d) { var c = cur.play.clocks[+d.i]; if (!c) return; if ((c.name || c.filled) && !window.confirm('Remove the clock ' + (c.name || '') + '?')) return; cur.play.clocks.splice(+d.i, 1); commit(); },
    addclock: function (d) { var n = cur.root.querySelector('.ds-newclock'); cur.play.clocks.push({ name: n ? n.value.trim() : '', size: +d.n || 4, filled: 0 }); commit(); },
    memory: function (d) { var m = cur.play.memories[+d.i]; if (!m) return; m.filled = toggleTrack(m.filled, +d.n); commit(); },
    suspicion: function (d) { cur.play.suspicion = toggleTrack(cur.play.suspicion, +d.n); commit(); },
    log: function () { var n = cur.root.querySelector('.ds-newlog'); var v = n && n.value.trim(); if (!v) { if (n) n.focus(); return; } cur.play.log.unshift({ at: new Date().toISOString(), text: v }); commit(); },
    rmlog: function (d) { if (!window.confirm('Remove this log entry?')) return; cur.play.log.splice(+d.i, 1); commit(); }
  };
  var CHANGES = {
    addkey: function (sel) { var v = sel.value; sel.value = ''; if (!v || cur.play.keys.length >= 4) return; var k = v === '*' ? { name: '', down: '', up: '' } : keyParts(v); k.hits = 0; k.deadlock = null; cur.play.keys.push(k); commit(); if (v === '*') { var last = cur.root.querySelectorAll('.ds-key-name'); if (last.length) last[last.length - 1].focus(); } },
    mastery: function (inp) { cur.play.mastery = !!inp.checked; commit(); },
    vice: function (sel) { cur.play.vice = sel.value; commit(); }
  };
  function onClick(e) {
    if (!cur) return; var t = e.target && e.target.closest ? e.target.closest('[data-act]') : null; if (!t || !cur.root.contains(t)) return;
    if (t.disabled) return; var act = t.getAttribute('data-act'); var fn = ACTIONS[act]; if (!fn) return;
    if (readOnly() && act !== 'back' && act !== 'view') return;
    var d = {}; for (var i = 0; i < t.attributes.length; i++) { var a = t.attributes[i]; if (a.name.indexOf('data-') === 0) d[a.name.slice(5)] = a.value; }
    try { fn(d, t); } catch (err) { setStatus('Something went wrong: ' + err.message, true); if (window.console) console.error(err); }
  }
  function onInput(e) {
    if (!cur || readOnly()) return; var t = e.target; if (!t || !t.dataset || !t.dataset.path || !cur.root.contains(t)) return;
    setPath(cur.play, t.dataset.path, t.value); scheduleSave();
  }
  function onChange(e) {
    if (!cur) return; var t = e.target; if (!t || !cur.root.contains(t)) return;
    if (t.dataset && t.dataset.change && CHANGES[t.dataset.change]) { if (readOnly()) return; try { CHANGES[t.dataset.change](t); } catch (err) { setStatus('Something went wrong: ' + err.message, true); } return; }
    if (t.dataset && t.dataset.path && cur.timer) { clearTimeout(cur.timer); cur.timer = null; flushSave(); }
  }
  function onKey(e) { if (!cur || e.key !== 'Enter') return; var t = e.target; if (!t || t.tagName !== 'INPUT' || !cur.root.contains(t)) return; var map = { 'ds-newlog': 'log', 'ds-newclock': 'addclock', 'ds-newcname': 'addcontact', 'ds-newcrole': 'addcontact', 'ds-newitem': 'additem', 'ds-newab': 'addability' }; var cls = Object.keys(map).filter(function (c) { return t.classList.contains(c); })[0]; if (!cls) return; e.preventDefault(); if (readOnly()) return; ACTIONS[map[cls]]({ n: 4 }, t); }

  /* ---------- API ---------- */
  T.open = function (doc, api) {
    var root = document.getElementById('dossier'); if (!root) return;
    if (cur) T.close();
    doc = doc || {}; cur = { doc: doc, api: api || {}, pb: pbOf(doc.playbook), root: root, ui: { mug: false, advance: null, confirmRemove: false }, timer: null, saving: 0 };
    cur.play = normalize(doc.play, doc.sheet, doc.playbook);
    root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onChange); root.addEventListener('keydown', onKey);
    render();
    if (!doc.play && !readOnly()) flushSave(); /* a doc filed without a play object gets one */
  };
  T.update = function (doc) {
    if (!cur || !doc) return; if (doc.id && cur.doc.id && doc.id !== cur.doc.id) return;
    if (cur.timer || cur.saving) { cur.doc = Object.assign({}, cur.doc, doc, { play: cur.play }); return; } /* our own change is on its way; it will come back */
    var focus = captureFocus(); cur.doc = doc; cur.pb = pbOf(doc.playbook) || cur.pb;
    var incoming = normalize(doc.play, doc.sheet, doc.playbook);
    if (focus && focus.path) setPath(incoming, focus.path, focus.value); /* never clobber what is being typed */
    cur.play = incoming; render();
  };
  T.close = function () {
    if (!cur) return; var c = cur;
    if (c.timer) { clearTimeout(c.timer); c.timer = null; flushSave(); } /* typed text still waiting goes out before the sheet closes */
    cur = null; if (c.rmT) clearTimeout(c.rmT); if (c.statusT) clearTimeout(c.statusT);
    c.root.removeEventListener('click', onClick); c.root.removeEventListener('input', onInput); c.root.removeEventListener('change', onChange); c.root.removeEventListener('keydown', onKey);
    c.root.innerHTML = ''; c.root.className = 'dossier';
  };
  T.isOpen = function () { return !!cur; };
  T.play = function () { return cur ? clone(cur.play) : null; };
})();
