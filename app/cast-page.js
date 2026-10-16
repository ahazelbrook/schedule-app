/* The cast (CAST.md): NPC portraits with a short description. Everyone sees a grid of the NPCs the GM has revealed (#cast),
   one NPC large enough to show on a laptop to the table (#cast/<id>), and the "on stage" banner on every screen; the GM also
   sees the hidden ones, reveals and hides, puts NPCs on stage and edits them (#cast/<id>/edit, #cast/new).
   Data: the `npcs` collection (cf.js on the hosted build, the artifact db elsewhere), one doc per NPC:
   { name, alias, role, faction, description, spec, revealed, firstSeen, tags, gmNotes }, and `campaign.scene`
   = { npcs: { <id>: true | false }, at }, which only the GM writes (boot.js passes the campaign snapshots in, and saves the scene).
   Defines window.B68CastPage (not B68Cast: that is the figure canon in figures/cast.js). Boot calls init(api) once the files
   settle, campaign(doc) on every campaign snapshot, and open(hash) / route(hash) / close() for the #cast mode. Every control
   is a plain button or link; nothing here throws when the kit, the db or the canon is missing. */
(function () {
  'use strict';
  var K = window.B68Figure, CANON = window.B68Cast;
  var M = window.B68CastPage = {};

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function nowIso() { return new Date().toISOString(); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'npc'; }
  function $(id) { return document.getElementById(id); }
  function toast(msg, bad) { var A = window.B68; if (A && A.toast) A.toast(msg, !!bad); }
  function errText(e) { return e && e.message || String(e || 'unknown error'); }
  function getPath(o, path) { for (var i = 0; i < path.length; i++) { if (!isObj(o)) return undefined; o = o[path[i]]; } return o; }
  function setPath(o, path, v) {
    for (var i = 0; i < path.length - 1; i++) { if (!isObj(o[path[i]])) o[path[i]] = {}; o = o[path[i]]; }
    if (v === undefined || v === '') delete o[path[path.length - 1]]; else o[path[path.length - 1]] = v;
  }

  /* ---------- state ---------- */
  var api = null, col = null, unsub = null;
  var npcs = {};                 /* id -> doc, as the server (or the db) sent it */
  var loaded = false, failed = null;
  var scene = null;              /* campaign.scene */
  var isOpen = false, view = { kind: 'grid' }, ed = null, filter = 'all';
  var stageKey = '', DISMISS = 'b68.stage.dismissed', dismissedMem = '';
  var memo = {};                 /* "place:id" -> { key, svg }: a figure is drawn again only when its spec changed */

  function gm() { return !!api && api.isGM() === true && api.canWrite() !== false; }
  /* the NPCs this viewer may see, as { id, doc } sorted by name. A player gets the revealed ones only, and never gmNotes:
     the hosted server already sends nothing else, this keeps the artifact's shared collection honest in the page. */
  function visible() {
    var out = [], g = gm();
    Object.keys(npcs).forEach(function (id) {
      var d = npcs[id]; if (!isObj(d)) return;
      if (!g) { if (d.revealed !== true) return; d = clone(d); delete d.gmNotes; }
      out.push({ id: id, doc: d });
    });
    out.sort(function (a, b) { return str(a.doc.name).toLowerCase() < str(b.doc.name).toLowerCase() ? -1 : 1; });
    return out;
  }
  function find(id) { var v = visible(); for (var i = 0; i < v.length; i++) if (v[i].id === id) return v[i].doc; return null; }
  function stagedIds() {
    var m = scene && isObj(scene.npcs) ? scene.npcs : {};
    return Object.keys(m).filter(function (id) { return m[id] === true; });
  }
  function onStage(id) { return stagedIds().indexOf(id) >= 0; }
  function sub(d) { return [str(d.role), str(d.faction)].filter(Boolean).join(' · '); }

  /* ---------- figures (figure-kit.js): a mugshot or a full figure, memoised per place ---------- */
  function draw(place, id, spec, how) {
    var key = how + JSON.stringify(spec), hit = memo[place + ':' + id];
    if (hit && hit.key === key) return hit.svg;
    var svg = '';
    try {
      var s = clone(spec); if (!isObj(s)) return '';
      s.id = 'cp-' + place + '-' + slug(id);
      var r = how === 'fig' ? K.render(s, { height: 900 }) : K.portrait(s, { lod: how === 'mug-lo' ? 'lo' : 'mid' });
      svg = r.svg.replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1');
    } catch (e) { svg = ''; }
    memo[place + ':' + id] = { key: key, svg: svg };
    return svg;
  }
  /* fill the figure holders under `root` one at a time, so a phone paints the page before it has drawn them all */
  function fillFigures(root) {
    var holders = [].slice.call(root.querySelectorAll('[data-fig]')), i = 0;
    (function next() {
      if (i >= holders.length) return;
      var h = holders[i++];
      if (root.contains(h)) {
        var d = find(h.getAttribute('data-id')), how = h.getAttribute('data-fig');
        if (d && K) h.innerHTML = draw(h.getAttribute('data-place'), h.getAttribute('data-id'), d.spec, how) || '<span class="cp-nofig">No figure</span>';
      }
      setTimeout(next, 0);
    })();
  }
  function holder(place, id, how, cls) { return '<div class="' + cls + '" data-fig="' + how + '" data-place="' + place + '" data-id="' + esc(id) + '" aria-hidden="true"></div>'; }

  /* ---------- the db ---------- */
  function ensureSub() {
    if (col || !api) return;
    var db = api.db(); if (!db) return;
    try { col = db.collection('npcs'); } catch (e) { col = null; failed = e; return; }
    try {
      unsub = col.onSnapshot(function (snap) {
        var m = {}; (snap && snap.docs || []).forEach(function (d) { var data = d && typeof d.data === 'function' ? d.data() : null; if (isObj(data)) m[d.id] = data; });
        npcs = m; loaded = true; failed = null; changed();
      }, function (e) { failed = e; changed(); });
    } catch (e) { col = null; failed = e; }
  }
  function ref(id) { try { return col && col.doc(id); } catch (e) { return null; } }
  /* a partial change to one NPC: an update where the store has one, else the whole doc */
  function patchNpc(id, patch) {
    var r = ref(id); if (!r) return Promise.reject(new Error('The cast is not available here.'));
    if (typeof r.update === 'function') return Promise.resolve().then(function () { return r.update(clone(patch)); });
    return Promise.resolve().then(function () { return r.set(Object.assign({}, clone(npcs[id] || {}), clone(patch))); });
  }
  function changed() { renderStage(); if (isOpen && !ed) render(); }

  /* ---------- the stage: who is on stage, for everyone ---------- */
  function scenePatch(id, on) { var o = {}; o[id] = on; return { npcs: o, at: nowIso() }; }
  function putOnStage(id) {
    var d = npcs[id]; if (!d || !gm() || !api) return Promise.resolve();
    /* revealed first, so no player ever sees a scene naming an NPC they were not sent */
    var pre = d.revealed === true && d.firstSeen ? Promise.resolve() : patchNpc(id, { revealed: true, firstSeen: d.firstSeen || nowIso() });
    return pre.then(function () { return api.saveScene(scenePatch(id, true)); }).catch(function (e) { toast('Could not put ' + str(d.name) + ' on stage: ' + errText(e), true); });
  }
  function offStage(id) {
    if (!gm() || !api) return Promise.resolve();
    return Promise.resolve().then(function () { return api.saveScene(scenePatch(id, false)); }).catch(function (e) { toast('Could not change the stage: ' + errText(e), true); });
  }
  function clearStage() {
    var ids = stagedIds(); if (!ids.length || !gm() || !api) return Promise.resolve();
    var o = {}; ids.forEach(function (id) { o[id] = false; });
    return Promise.resolve().then(function () { return api.saveScene({ npcs: o, at: nowIso() }); }).then(function () { toast('The stage is clear.'); }, function (e) { toast('Could not clear the stage: ' + errText(e), true); });
  }
  function setRevealed(id, on) {
    if (!gm()) return;
    var d = npcs[id]; if (!d) return;
    var p = patchNpc(id, on ? { revealed: true, firstSeen: d.firstSeen || nowIso() } : { revealed: false });
    p.then(function () { if (!on && onStage(id)) return offStage(id); }).catch(function (e) { toast('Could not change ' + str(d.name) + ': ' + errText(e), true); });
  }

  /* the banner: the staged NPCs the viewer may see (revealed, and still there). A player can hide it; it comes back with the
     next change of the stage (a new `at`). */
  function dismissed() { try { return localStorage.getItem(DISMISS) || dismissedMem; } catch (e) { return dismissedMem; } }
  function dismiss() { dismissedMem = scene && scene.at || ''; try { localStorage.setItem(DISMISS, dismissedMem); } catch (e) {} renderStage(); }
  function undismiss() { dismissedMem = ''; try { localStorage.removeItem(DISMISS); } catch (e) {} strip.expanded = true; stageKey = ''; renderStage(); }
  /* on a phone the banner is a one-line strip (portrait thumbs and names) that opens to the full banner for a while when the stage
     changes, or on a tap; a desk always gets the full banner */
  var strip = { expanded: false, timer: null, seenAt: null };
  function phoneNow() { try { return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches); } catch (e) { return false; } }
  var STRIP_SHOW_MS = 8000;
  function expandFor(ms) { strip.expanded = true; if (strip.timer) clearTimeout(strip.timer); strip.timer = setTimeout(function () { strip.timer = null; strip.expanded = false; renderStage(); }, ms); }
  function setExpanded(on) { if (strip.timer) { clearTimeout(strip.timer); strip.timer = null; } strip.expanded = !!on; renderStage(); }
  function stagedNames() { return stagedIds().map(function (id) { var d = npcs[id]; return d && d.revealed === true ? str(d.name) : ''; }).filter(Boolean); }
  M.onStage = stagedNames;
  M.showStage = undismiss;
  function renderStage() {
    var box = $('stageBanner'); if (!box) return;
    var list = stagedIds().map(function (id) { var d = npcs[id]; return d && d.revealed === true ? { id: id, doc: d } : null; }).filter(Boolean);
    var at = scene && scene.at || '';
    if (!list.length || dismissed() === at && at) { if (stageKey) { stageKey = ''; box.hidden = true; box.innerHTML = ''; box.classList.remove('cp-collapsed'); document.documentElement.style.removeProperty('--cp-stage-h'); } return; }
    var phone = phoneNow();
    if (phone && at !== strip.seenAt) { strip.seenAt = at; expandFor(STRIP_SHOW_MS); }   /* a changed stage: the reveal lands in full, then folds to the strip */
    var asStrip = phone && !strip.expanded;
    var key = at + '|' + gm() + '|' + asStrip + '|' + JSON.stringify(list.map(function (x) { return [x.id, x.doc.name, x.doc.role, x.doc.faction, x.doc.description, x.doc.spec]; }));
    if (key === stageKey) return;
    stageKey = key;
    if (asStrip) {
      var names = list.map(function (x) { return str(x.doc.name); }).join(', ');
      box.innerHTML = '<div class="cp-st-strip" role="button" tabindex="0" data-cp="expand" aria-expanded="false" aria-label="On stage: ' + esc(names) + '. Show more"><span class="cp-st-kick">On stage</span>' +
        list.map(function (x) { return '<span class="cp-st-npc cp-st-mini">' + holder('st', x.id, 'mug-lo', 'cp-fig-mug') + '<span class="cp-st-name">' + esc(x.doc.name) + '</span></span>'; }).join('') +
        '<span class="cp-st-more" aria-hidden="true">▲</span></div>';
      box.classList.add('cp-collapsed');
    } else {
      var rows = list.map(function (x) {
        var d = x.doc;
        return '<article class="cp-st-npc"><a class="cp-st-pic" href="#cast/' + encodeURIComponent(x.id) + '" aria-label="' + esc(str(d.name)) + ', full size">' + holder('st', x.id, 'mug', 'cp-fig-mug') + '</a>' +
          '<div class="cp-st-txt"><h3 class="cp-st-name">' + esc(d.name) + (d.alias ? ' <small>“' + esc(d.alias) + '”</small>' : '') + '</h3>' + (sub(d) ? '<p class="cp-st-sub">' + esc(sub(d)) + '</p>' : '') +
          '<p class="cp-st-desc">' + esc(d.description) + '</p></div></article>';
      }).join('');
      box.innerHTML = '<div class="cp-st-head"><span class="cp-st-kick">On stage</span><span class="cp-st-acts">' +
        (gm() ? '<button type="button" class="btn sm" data-cp="clear">Clear stage</button>' : '') +
        (phone ? '<button type="button" class="btn sm" data-cp="collapse" aria-label="Fold the banner to one line">Less</button>' : '') +
        '<button type="button" class="btn sm" data-cp="dismiss" aria-label="Hide this until the stage changes">Hide</button></span></div><div class="cp-st-list">' + rows + '</div>';
      box.classList.remove('cp-collapsed');
    }
    box.hidden = false;
    fillFigures(box);
    sizeStage();
  }
  /* the strip is for a phone; a resize across 760px redraws the banner in the other form */
  (function () {
    try {
      var mq = window.matchMedia && window.matchMedia('(max-width: 760px)'); if (!mq) return;
      var onChange = function () { stageKey = ''; renderStage(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    } catch (e) {}
  })();
  /* the page keeps its last lines clear of the banner */
  function sizeStage() {
    var box = $('stageBanner'); if (!box || box.hidden) return;
    setTimeout(function () { try { document.documentElement.style.setProperty('--cp-stage-h', Math.ceil(box.getBoundingClientRect().height) + 'px'); } catch (e) {} }, 60);
  }
  window.addEventListener('resize', sizeStage);

  /* ---------- the page ---------- */
  function root() { return $('cast-page'); }
  function parse(h) {
    var m = /^#cast(?:\/([^/]+))?(?:\/(edit))?\/?$/.exec(h || '');
    if (!m || !m[1]) return { kind: 'grid' };
    var id = m[1]; try { id = decodeURIComponent(id); } catch (e) {}
    if (id === 'new' && !m[2]) return { kind: 'new' };
    return { kind: m[2] ? 'edit' : 'detail', id: id };
  }
  M.open = function (h) { isOpen = true; ensureSub(); view = parse(h); ed = null; render(); };
  M.route = function (h) { if (!isOpen) return; var v = parse(h); if (same(v, view)) return; view = v; ed = null; render(); };
  M.close = function () { isOpen = false; ed = null; var r = root(); if (r) r.innerHTML = ''; };
  /* the cast is fetched when someone opens it or the stage names an NPC; until then it costs nothing */
  M.init = function (a) { api = a; if (isOpen || stagedIds().length) ensureSub(); if (isOpen) render(); renderStage(); };
  M.campaign = function (doc) {
    var s = doc && isObj(doc.scene) ? doc.scene : null;
    if (same(s, scene)) return;
    scene = s;
    if (stagedIds().length) ensureSub();
    renderStage();
    if (isOpen && !ed) render();
  };

  function render() {
    var r = root(); if (!r) return;
    var head = '<header class="cp-head"><div class="cp-title"><span class="cp-kick">Blades ’68</span><h2 class="cp-h" id="cp-h" tabindex="-1">The cast</h2></div><div class="cp-meta">' +
      (gm() ? '<span class="cp-role gm">GM</span>' : '') + '</div></header>';
    var body;
    if (!api || !api.db()) body = api ? note('The cast needs the shared files. Open this page where the files are available (the published artifact or the hosted site).', true) : note('Opening the cast…');
    else if (failed && !loaded) body = note(/unknown collection|not available/i.test(errText(failed)) ? 'The cast is not available in this view.' : 'The cast is offline: ' + esc(errText(failed)), true);
    else if (!loaded) body = note('Opening the cast…');
    else if (view.kind === 'edit' || view.kind === 'new') body = gm() ? editorView() : note('Only the GM can edit the cast. <a href="#cast">Back to the cast</a>');
    else if (view.kind === 'detail') body = detailView(view.id);
    else body = gridView();
    r.innerHTML = view.kind === 'grid' || !loaded ? head + body : body;
    if (view.kind === 'edit' || view.kind === 'new') { if (loaded && gm()) wireEditor(); }
    fillFigures(r);
  }
  /* a line of text in a box (`html` is trusted markup, never user text) */
  function note(html, bad) { return '<p class="cp-note' + (bad ? ' bad' : '') + '" role="status">' + html + '</p>'; }

  /* ---------- the grid ---------- */
  function gridView() {
    var all = visible(), g = gm(), staged = stagedIds().filter(function (id) { return npcs[id]; });
    var list = all.filter(function (x) {
      if (!g || filter === 'all') return true;
      return filter === 'stage' ? onStage(x.id) : filter === 'revealed' ? x.doc.revealed === true : x.doc.revealed !== true;
    });
    var h = '<div class="cp-bar"><p class="cp-count">' + (g ? all.length + ' NPC' + (all.length === 1 ? '' : 's') + ' · ' + all.filter(function (x) { return x.doc.revealed === true; }).length + ' revealed' : all.length ? all.length + ' met' : '') + '</p>';
    if (g) {
      h += '<div class="seg cp-filter" role="group" aria-label="Show">' + [['all', 'All'], ['revealed', 'Revealed'], ['hidden', 'Hidden'], ['stage', 'On stage']].map(function (f) { return '<button type="button" class="chip sm" data-cp="filter" data-f="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div>' +
        '<span class="cp-bar-acts">' + (staged.length ? '<button type="button" class="btn sm" data-cp="clear">Clear stage</button>' : '') + '<a class="btn sm primary" href="#cast/new" role="button">New NPC</a></span>';
    }
    h += '</div>';
    if (!list.length) {
      h += '<div class="cp-empty">' + (all.length ? 'No NPC matches that filter.' : g ? 'The cast is empty.' : 'No one has been introduced yet. When the GM puts someone on stage, they appear here.') + '</div>';
      if (g && !all.length) h += '<p><button type="button" class="btn" data-cp="seed">Add the starting NPCs</button></p>';
      return h;
    }
    return h + '<div class="cp-grid">' + list.map(function (x) { return card(x.id, x.doc, g); }).join('') + '</div>';
  }
  function card(id, d, g) {
    var href = '#cast/' + encodeURIComponent(id), st = onStage(id), hid = d.revealed !== true;
    var h = '<article class="cp-card' + (hid ? ' hidden' : '') + (st ? ' staged' : '') + '" data-id="' + esc(id) + '">' +
      '<a class="cp-pic" href="' + href + '" aria-label="' + esc(str(d.name)) + '">' + holder('grid', id, 'mug-lo', 'cp-fig-mug') + (g ? '<span class="cp-badge' + (st ? ' stage' : hid ? ' hid' : '') + '">' + (st ? 'On stage' : hid ? 'Hidden' : 'Revealed') + '</span>' : '') + '</a>' +
      '<div class="cp-body"><h3 class="cp-name"><a href="' + href + '">' + esc(d.name || 'Unnamed') + '</a>' + (d.alias ? ' <small>“' + esc(d.alias) + '”</small>' : '') + '</h3>' +
      (sub(d) ? '<p class="cp-sub">' + esc(sub(d)) + '</p>' : '') + '<p class="cp-desc">' + esc(d.description) + '</p>';
    if (g) {
      h += '<div class="cp-acts"><button type="button" class="chip sm" data-cp="stage" data-id="' + esc(id) + '" aria-pressed="' + st + '">' + (st ? 'Off stage' : 'On stage') + '</button>' +
        '<button type="button" class="chip sm" data-cp="reveal" data-id="' + esc(id) + '">' + (hid ? 'Reveal' : 'Hide') + '</button>' +
        '<a class="chip sm" href="#cast/' + encodeURIComponent(id) + '/edit" role="button">Edit</a></div>';
    }
    return h + '</div></article>';
  }

  /* ---------- one NPC, large: a laptop at the table ---------- */
  function detailView(id) {
    var d = find(id);
    if (!d) return '<nav class="cp-crumb"><a href="#cast">← The cast</a></nav>' + note(gm() ? 'There is no such NPC.' : 'This person is not in the cast (yet).');
    var g = gm(), st = onStage(id), hid = d.revealed !== true;
    var h = '<nav class="cp-crumb"><a href="#cast">← The cast</a></nav><article class="cp-detail" data-id="' + esc(id) + '"><div class="cp-fig-big">' + holder('big', id, 'fig', 'cp-fig') + '</div><div class="cp-text">' +
      '<p class="cp-kick">' + esc(sub(d) || 'Blades ’68') + (g && hid ? ' · hidden from the players' : '') + (st ? ' · on stage' : '') + '</p>' +
      '<h2 class="cp-dname" id="cp-h" tabindex="-1">' + esc(d.name || 'Unnamed') + '</h2>' + (d.alias ? '<p class="cp-alias">“' + esc(d.alias) + '”</p>' : '') +
      '<p class="cp-ddesc">' + esc(d.description) + '</p>';
    if (Array.isArray(d.tags) && d.tags.length) h += '<p class="cp-tags">' + d.tags.map(function (t) { return '<span class="chip sm txt">' + esc(t) + '</span>'; }).join('') + '</p>';
    if (g) {
      if (d.gmNotes) h += '<div class="cp-gmnotes"><span class="cp-lab">GM notes · only you see this</span><p>' + esc(d.gmNotes) + '</p></div>';
      h += '<div class="cp-acts big"><button type="button" class="btn' + (st ? '' : ' primary') + '" data-cp="stage" data-id="' + esc(id) + '" aria-pressed="' + st + '">' + (st ? 'Take off stage' : 'Put on stage') + '</button>' +
        '<button type="button" class="btn" data-cp="reveal" data-id="' + esc(id) + '">' + (hid ? 'Reveal to the players' : 'Hide from the players') + '</button>' +
        '<a class="btn" href="#cast/' + encodeURIComponent(id) + '/edit" role="button">Edit</a></div>';
    }
    return h + '</div></article>';
  }

  /* ---------- the editor (GM) ---------- */
  var BLANK = { heightIn: 68, figure: 'masc', shape: 'lean', skin: 'fair', age: 35, face: { eyes: 'almond', brows: 'straight', nose: 'straight', mouth: 'neutral', expression: 'neutral' }, hair: { style: 'short', color: 'cloth-brown' },
    outfit: { base: { type: 'shirt', color: 'cloth-cream' }, bottom: { type: 'trousers', color: 'cloth-charcoal' }, feet: { type: 'oxfords', color: 'cloth-black' } }, props: [] };
  var SLOTS = [['base', 'top', 'Top'], ['mid', 'mid', 'Mid layer'], ['outer', 'outer', 'Coat or jacket'], ['neck', 'neckwear', 'Neck'], ['bottom', 'bottom', 'Trousers or skirt'], ['dress', 'dress', 'Dress'], ['legs', 'legwear', 'Legs'], ['feet', 'footwear', 'Shoes'], ['waist', 'belt', 'Belt']];
  function opts() { try { return K && K.options ? K.options() : {}; } catch (e) { return {}; } }
  function names(v) { return Array.isArray(v) ? v : isObj(v) ? Object.keys(v) : []; }
  function colours(O) { return names(O.cloth).concat(['ink-300', 'ink-500', 'ink-900', 'leather-black', 'leather-brown', 'metal-brass', 'metal-steel']); }

  function newDoc() { return { name: '', alias: '', role: '', faction: '', description: '', spec: clone(BLANK), revealed: false, firstSeen: null, tags: [], gmNotes: '' }; }
  function editorView() {
    var isNew = view.kind === 'new', src = isNew ? newDoc() : npcs[view.id];
    if (!src) return '<nav class="cp-crumb"><a href="#cast">← The cast</a></nav>' + note('There is no such NPC.');
    ed = { isNew: isNew, id: isNew ? '' : view.id, doc: Object.assign(newDoc(), clone(src)), busy: false };
    if (!isObj(ed.doc.spec)) ed.doc.spec = clone(BLANK);
    var d = ed.doc, O = opts();
    function field(label, name, val, o) {
      o = o || {};
      return '<label class="cp-field' + (o.wide ? ' wide' : '') + '"><span class="cp-lab">' + label + '</span>' + (o.area ? '<textarea data-f="' + name + '" rows="' + o.area + '" maxlength="' + o.max + '">' + esc(val) + '</textarea>' : '<input type="text" data-f="' + name + '" value="' + esc(val) + '" maxlength="' + (o.max || 80) + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>') + '</label>';
    }
    var h = '<nav class="cp-crumb"><a href="' + (isNew ? '#cast' : '#cast/' + encodeURIComponent(ed.id)) + '">← ' + (isNew ? 'The cast' : esc(d.name || 'Back')) + '</a></nav>' +
      '<form class="cp-editor" id="cp-form" novalidate><h2 class="cp-dname" id="cp-h" tabindex="-1">' + (isNew ? 'New NPC' : 'Edit ' + esc(d.name || 'NPC')) + '</h2><div class="cp-egrid"><div class="cp-ecol">' +
      '<fieldset class="cp-box"><legend>About</legend><div class="cp-fields">' +
      field('Name', 'name', d.name, { wide: true }) + field('Alias', 'alias', d.alias) + field('Role', 'role', d.role) + field('Faction', 'faction', d.faction) +
      field('Description (what the players see)', 'description', d.description, { area: 5, max: 2000, wide: true }) +
      field('Tags (commas)', 'tags', (d.tags || []).join(', '), { wide: true, ph: 'e.g. Undertow, bar' }) +
      field('GM notes (never sent to players)', 'gmNotes', d.gmNotes, { area: 5, max: 8000, wide: true }) +
      '<label class="cp-check wide"><input type="checkbox" data-f="revealed"' + (d.revealed ? ' checked' : '') + '> <span>Revealed: the players can see this NPC in the cast</span></label></div></fieldset>' +
      '<fieldset class="cp-box"><legend>Figure</legend><div class="cp-fields">' +
      '<label class="cp-field"><span class="cp-lab">Start from</span><select id="cp-arch"><option value="">Pick an archetype…</option><option value="__blank">Blank figure</option>' + ((CANON && CANON.npcs) || []).map(function (n) { return '<option value="' + esc(n.id) + '">' + esc(n.name) + '</option>'; }).join('') + '</select></label>' +
      adjust(O) + '<label class="cp-field wide"><span class="cp-lab">Spec (JSON): paste one, then Use this spec</span><textarea id="cp-spec" rows="6" spellcheck="false" class="mono"></textarea></label>' +
      '<div class="cp-acts wide"><button type="button" class="btn sm" data-cp="usespec">Use this spec</button><span class="cp-specmsg" id="cp-specmsg" role="status"></span></div></div></fieldset></div>' +
      '<div class="cp-ecol cp-prev"><div class="cp-sticky"><span class="cp-lab">Preview</span><div class="cp-prevgrid"><div class="cp-prev-mug" id="cp-prev-mug"></div><div class="cp-prev-fig" id="cp-prev-fig"></div></div><p class="cp-warn" id="cp-warn" role="status"></p></div></div></div>' +
      '<p class="cp-err" id="cp-err" role="alert"></p><div class="cp-acts big"><button type="button" class="btn primary" data-cp="save">' + (isNew ? 'Add to the cast' : 'Save') + '</button><a class="btn" href="' + (isNew ? '#cast' : '#cast/' + encodeURIComponent(ed.id)) + '" role="button">Cancel</a>' +
      (isNew ? '' : '<button type="button" class="btn cp-del" data-cp="delete">Delete this NPC</button>') + '</div></form>';
    return h;
  }
  /* dropdowns generated from K.options(): every name the kit knows */
  function sel(label, attr, list, cur, none) {
    return '<label class="cp-field"><span class="cp-lab">' + label + '</span><select ' + attr + '>' + (none ? '<option value="">' + none + '</option>' : '') +
      list.map(function (n) { return '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>';
  }
  function num(label, path, min, max, step) { return '<label class="cp-field"><span class="cp-lab">' + label + '</span><input type="number" data-p="' + path + '" min="' + min + '" max="' + max + '" step="' + step + '"></label>'; }
  function adjust(O) {
    var sp = ed.doc.spec, cl = colours(O), h = '<div class="cp-adjust wide"><span class="cp-lab">Adjust</span><div class="cp-fields">';
    h += sel('Figure', 'data-p="figure"', ['masc', 'fem'], sp.figure || 'masc') + num('Height (inches)', 'heightIn', 40, 90, 1) + num('Age', 'age', 6, 95, 1) + sel('Shape', 'data-p="shape"', names(O.shapes), sp.shape, 'default') +
      num('Build', 'build', 0.7, 1.4, 0.01) + num('Heads tall', 'heads', 5.5, 8.6, 0.1) + sel('Skin', 'data-p="skin"', names(O.skins), sp.skin, 'default') + sel('Body', 'data-p="body.type"', names(O.body), getPath(sp, ['body', 'type']), 'standard') +
      sel('Head', 'data-p="head.shape"', names(O.head), getPath(sp, ['head', 'shape']), 'default') + sel('Eyes', 'data-p="face.eyes"', names(O.eyes), getPath(sp, ['face', 'eyes']), 'default') +
      sel('Brows', 'data-p="face.brows"', names(O.brows), getPath(sp, ['face', 'brows']), 'default') + sel('Nose', 'data-p="face.nose"', names(O.nose), getPath(sp, ['face', 'nose']), 'default') +
      sel('Mouth', 'data-p="face.mouth"', names(O.mouth), getPath(sp, ['face', 'mouth']), 'default') + sel('Expression', 'data-p="face.expression"', names(O.expression), getPath(sp, ['face', 'expression']), 'default') +
      sel('Facial hair', 'data-t="face.facialHair"', names(O.facialHair), getPath(sp, ['face', 'facialHair', 'type']), 'None') + sel('Eyewear', 'data-t="face.eyewear"', names(O.eyewear), getPath(sp, ['face', 'eyewear', 'type']), 'None') +
      sel('Hair', 'data-p="hair.style"', names(O.hair), getPath(sp, ['hair', 'style']), 'default') + sel('Hair colour', 'data-p="hair.color"', cl, getPath(sp, ['hair', 'color']), 'default') +
      sel('Hat', 'data-t="hair.hat"', names(O.hat), getPath(sp, ['hair', 'hat', 'type']), 'None') +
      sel('Stance', 'data-p="pose.stance"', ['square', 'easy', 'wide'], getPath(sp, ['pose', 'stance']), 'default') +
      sel('Right arm', 'data-p="pose.arms.R"', names(O.armPoses), getPath(sp, ['pose', 'arms', 'R']), 'default') + sel('Left arm', 'data-p="pose.arms.L"', names(O.armPoses), getPath(sp, ['pose', 'arms', 'L']), 'default') + '</div>';
    h += '<span class="cp-lab sp">Clothes</span><div class="cp-fields">';
    SLOTS.forEach(function (s) {
      var cur = getPath(sp, ['outfit', s[0]]);
      h += sel(s[2], 'data-t="outfit.' + s[0] + '"', names(O[s[1]]), cur && cur.type, 'None') + sel(s[2] + ' colour', 'data-c="outfit.' + s[0] + '"', cl, cur && cur.color, 'default');
    });
    h += '</div><span class="cp-lab sp">Props</span><div class="cp-props">' + names(O.prop).map(function (n) { return '<label class="cp-check"><input type="checkbox" data-prop="' + esc(n) + '"> <span>' + esc(n) + '</span></label>'; }).join('') + '</div></div>';
    return h;
  }

  /* put the draft's figure into the controls (all of them, or all but the one being typed in) */
  function syncControls(skip) {
    var r = root(), sp = ed.doc.spec; if (!r) return;
    [].forEach.call(r.querySelectorAll('#cp-form [data-p]'), function (n) {
      if (n === skip) return; var v = getPath(sp, n.getAttribute('data-p').split('.')); n.value = v == null ? '' : v;
    });
    [].forEach.call(r.querySelectorAll('#cp-form [data-t]'), function (n) { if (n !== skip) { var v = getPath(sp, n.getAttribute('data-t').split('.')); n.value = v && v.type || ''; } });
    [].forEach.call(r.querySelectorAll('#cp-form [data-c]'), function (n) { if (n !== skip) { var v = getPath(sp, n.getAttribute('data-c').split('.')); n.value = v && v.color || ''; } });
    var props = Array.isArray(sp.props) ? sp.props : [];
    [].forEach.call(r.querySelectorAll('#cp-form [data-prop]'), function (n) { n.checked = props.some(function (p) { return p && p.type === n.getAttribute('data-prop'); }); });
    var t = $('cp-spec'); if (t && t !== skip) t.value = JSON.stringify(sp, null, 1);
  }
  var prevTimer = null;
  function preview() {
    if (prevTimer) clearTimeout(prevTimer);
    prevTimer = setTimeout(function () {
      prevTimer = null;
      var m = $('cp-prev-mug'), f = $('cp-prev-fig'), w = $('cp-warn'); if (!ed || !m || !f) return;
      var s = clone(ed.doc.spec) || {}; s.id = 'cp-prev'; s.name = ed.doc.name || 'Preview'; if (!s.plate) s.plate = s.name; if (!s.code) s.code = 'NPC-968-0000';
      try {
        var a = K.portrait(s, { lod: 'mid' }), b = K.render(clone(s), { height: 560 });
        m.innerHTML = a.svg.replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1');
        f.innerHTML = b.svg.replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1');
        var ws = (a.warnings || []).concat(b.warnings || []).filter(function (x, i, arr) { return arr.indexOf(x) === i; });
        if (w) w.textContent = ws.length ? 'The kit says: ' + ws.join(' · ') : '';
      } catch (e) { if (w) w.textContent = 'This spec could not be drawn: ' + errText(e); }
    }, 90);
  }
  function wireEditor() { syncControls(); preview(); }
  function fromCanon(id) {
    var n = ((CANON && CANON.npcs) || []).filter(function (x) { return x.id === id; })[0];
    var s = id === '__blank' ? clone(BLANK) : n ? clone(n) : null; if (!s) return;
    ['id', 'name', 'plate', 'code', 'archetype', 'notes', 'playbook'].forEach(function (k) { delete s[k]; });
    if (!Array.isArray(s.props)) s.props = [];
    ed.doc.spec = s; syncControls(); preview();
  }
  function setSpecField(n) {
    var sp = ed.doc.spec, v = n.value;
    if (n.hasAttribute('data-p')) {
      var path = n.getAttribute('data-p').split('.'), numeric = n.type === 'number';
      if (numeric) v = v === '' ? undefined : +v;
      setPath(sp, path, v);
    } else if (n.hasAttribute('data-t')) {          /* a part's type: kept with its colour, other parameters belong to the old type */
      var p2 = n.getAttribute('data-t').split('.'), old = getPath(sp, p2), part = v ? { type: v } : undefined;
      if (part && old && old.color) part.color = old.color;
      if (part && !part.color && p2[0] === 'outfit') part.color = 'cloth-charcoal';
      setPath(sp, p2, part);
    } else if (n.hasAttribute('data-c')) {
      var p3 = n.getAttribute('data-c').split('.'), cur = getPath(sp, p3);
      if (cur) { if (v) cur.color = v; else delete cur.color; }
    }
  }
  function readText() {
    var d = ed.doc, r = root();
    [].forEach.call(r.querySelectorAll('#cp-form [data-f]'), function (n) {
      var k = n.getAttribute('data-f');
      if (n.type === 'checkbox') d[k] = n.checked;
      else if (k === 'tags') d.tags = n.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      else d[k] = n.value;
    });
  }
  function save() {
    if (!ed || ed.busy) return;
    readText();
    var d = ed.doc, err = $('cp-err'); if (err) err.textContent = '';
    if (!d.name.trim()) { if (err) err.textContent = 'Give the NPC a name.'; var nf = root().querySelector('[data-f="name"]'); if (nf) nf.focus(); return; }
    var id = ed.id || 'npc_' + slug(d.name) + '_' + Date.now().toString(36);
    var sp = clone(d.spec) || {}; sp.id = slug(d.name); sp.name = d.name.trim(); sp.plate = sp.plate || sp.name; if (!sp.code) sp.code = 'NPC-968-' + String(Math.floor(Math.random() * 9000) + 1000);
    var doc = { name: d.name.trim(), alias: d.alias.trim(), role: d.role.trim(), faction: d.faction.trim(), description: d.description, spec: sp, revealed: !!d.revealed, firstSeen: d.firstSeen || (d.revealed ? nowIso() : null), tags: d.tags || [], gmNotes: d.gmNotes };
    var r = ref(id); if (!r) { if (err) err.textContent = 'The cast is not available here.'; return; }
    ed.busy = true; var wasStaged = onStage(id);
    Promise.resolve().then(function () { return r.set(clone(doc)); }).then(function () {
      if (!doc.revealed && wasStaged) return offStage(id);
    }).then(function () {
      ed = null; toast(doc.name + ' saved.'); location.hash = '#cast/' + encodeURIComponent(id);
    }, function (e) { ed.busy = false; if (err) err.textContent = 'Could not save: ' + errText(e); });
  }
  function remove() {
    if (!ed || ed.isNew || ed.busy) return;
    var id = ed.id, name = ed.doc.name || 'this NPC';
    if (!window.confirm('Delete ' + name + '? They disappear from the cast for everyone. This cannot be undone.')) return;
    var r = ref(id); if (!r) return;
    ed.busy = true;
    Promise.resolve().then(function () { return r.delete(); }).then(function () { return onStage(id) ? offStage(id) : null; }).then(function () {
      ed = null; toast(name + ' deleted.'); location.hash = '#cast';
    }, function (e) { ed.busy = false; var err = $('cp-err'); if (err) err.textContent = 'Could not delete: ' + errText(e); });
  }
  function useSpec() {
    var t = $('cp-spec'), m = $('cp-specmsg'); if (!t || !ed) return;
    var v; try { v = JSON.parse(t.value); } catch (e) { if (m) m.textContent = 'That is not valid JSON: ' + errText(e); return; }
    if (!isObj(v)) { if (m) m.textContent = 'A spec is a JSON object.'; return; }
    if (m) m.textContent = '';
    ed.doc.spec = v; syncControls(t); preview();
  }
  /* figures/npcs.js is fetched only when the GM asks: it holds hidden NPCs, so the page never loads it for everyone.
     The hosted build does not publish it (app/.assetsignore): there the seed rows come from migrations/0003_npcs.sql. */
  function loadSeed() {
    return new Promise(function (res, rej) {
      if (window.B68CastSeed) return res(window.B68CastSeed);
      var s = document.createElement('script'); s.src = 'figures/npcs.js';
      s.onload = function () { if (window.B68CastSeed) res(window.B68CastSeed); else rej(new Error('no starting NPCs')); };
      s.onerror = function () { rej(new Error('the starting NPCs are not published here (the hosted build adds them when it is deployed)')); };
      document.head.appendChild(s);
    });
  }
  function seed() {
    if (!gm() || !col) return;
    var done = 0;
    loadSeed().then(function (SEED) { return SEED.reduce(function (p, n) { return p.then(function () { return ref(n.id).set(clone(n.doc)).then(function () { done++; }); }); }, Promise.resolve()); })
      .then(function () { toast('Added ' + done + ' NPCs.'); }, function (e) { toast('Stopped after ' + done + ': ' + errText(e), true); });
  }

  /* ---------- events ---------- */
  function onClick(ev) {
    var b = ev.target.closest && ev.target.closest('[data-cp]'); if (!b) return;
    var a = b.getAttribute('data-cp'), id = b.getAttribute('data-id');
    if (a === 'stage') { ev.preventDefault(); if (onStage(id)) offStage(id); else putOnStage(id); }
    else if (a === 'reveal') { ev.preventDefault(); var d = npcs[id]; if (d) setRevealed(id, d.revealed !== true); }
    else if (a === 'clear') clearStage();
    else if (a === 'dismiss') dismiss();
    else if (a === 'expand') setExpanded(true);
    else if (a === 'collapse') setExpanded(false);
    else if (a === 'show') undismiss();
    else if (a === 'filter') { filter = b.getAttribute('data-f') || 'all'; render(); }
    else if (a === 'save') save();
    else if (a === 'delete') remove();
    else if (a === 'usespec') useSpec();
    else if (a === 'seed') seed();
  }
  function onInput(ev) {
    if (!ed) return; var n = ev.target;
    if (n.id === 'cp-arch') { if (n.value) fromCanon(n.value); n.value = ''; return; }
    if (n.hasAttribute('data-p') || n.hasAttribute('data-t') || n.hasAttribute('data-c')) { setSpecField(n); syncControls(n); preview(); }
    else if (n.hasAttribute('data-prop')) {
      var sp = ed.doc.spec, list = Array.isArray(sp.props) ? sp.props : [], t = n.getAttribute('data-prop');
      list = list.filter(function (p) { return !(p && p.type === t); }); if (n.checked) list.push({ type: t });
      sp.props = list; syncControls(n); preview();
    } else if (n.hasAttribute('data-f')) { readText(); if (n.getAttribute('data-f') === 'name') preview(); }
  }
  function wire() {
    var r = root(); if (r && !r.__cp) { r.__cp = true; r.addEventListener('click', onClick); r.addEventListener('input', onInput); r.addEventListener('change', onInput); }
    var s = $('stageBanner'); if (s && !s.__cp) { s.__cp = true; s.addEventListener('click', onClick); s.addEventListener('keydown', function (ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.getAttribute && ev.target.getAttribute('data-cp') === 'expand') { ev.preventDefault(); setExpanded(true); } }); }
  }
  wire();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
})();
