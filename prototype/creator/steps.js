/* The sixteen steps of the creator. Each section builds its controls once; sync functions keep them in step with the state. */
(function () {
  'use strict';
  var A = window.B68; if (!A || !A.K) return;
  var K = A.K, C = A.C, CT = A.CT, O = A.O, S = A.S, $ = A.$, el = A.el, esc = A.esc, clone = A.clone, pick = A.pick, chance = A.chance;
  var get = A.get, set = A.set, field = A.field, chips = A.chips, multi = A.multi, swatches = A.swatches, range = A.range, text = A.text, toggle = A.toggle, group = A.group, custom = A.custom, slot = A.slot;
  var CLOTH = A.CLOTH, HAIR_TOKENS = A.HAIR_TOKENS, SKINS = A.SKINS;
  var pb = A.pbOf;
  var hull = function () { var p = pb(); return !!(p && p.hull); };
  var vet = function () { var p = pb(); return !!(p && p.veteran); };
  var hasPb = function () { return !!pb(); };
  function note(html) { var n = el('p', 'hint'); n.innerHTML = html; return n; }
  function grid() { var g = el('div', 'grid2'); for (var i = 0; i < arguments.length; i++) g.appendChild(arguments[i]); return g; }
  function h3(t) { return el('h3', null, esc(t)); }

  /* ---------- 1 · Playbook ---------- */
  function choosePlaybook(id) {
    var p = CT.byId[id]; if (!p) return;
    var prev = S.sheet.playbook;
    S.sheet.playbook = id;
    if (prev !== id) { S.sheet.dots = clone(p.printed); S.sheet.ability = null; S.sheet.ability2 = null; S.sheet.frame = []; S.sheet.keys = []; S.sheet.deadlockKey = null; S.sheet.deadlockMode = null; S.sheet.contacts = {}; S.sheet.items = []; S.sheet.alt = []; S.sheet.owning = null; S.sheet.backing = null; S.sheet.cohortType = null; S.sheet.cohortHousing = null; }
    var num = (S.spec.code || '').split('-')[2]; if (!num || num === '0000') num = String(1000 + Math.floor(Math.random() * 9000));
    S.spec.code = p.prefix + '-968-' + num; S.spec.halo = p.halo;
    if (!S.dirty) A.applyLook(id); else A.changed();
  }
  A.choosePlaybook = choosePlaybook;
  function playbookStep() {
    var covers = el('div', 'covers');
    var sil = {};
    CT.PLAYBOOKS.forEach(function (p) {
      var b = el('button', 'pb'); b.type = 'button'; b.dataset.id = p.id;
      b.style.setProperty('--duo-a', p.duo ? p.duo[0] : '#f2ede1'); b.style.setProperty('--duo-b', p.duo ? p.duo[1] : '#14110e'); b.style.setProperty('--on-duo', '#fbf8f1');
      var svg = ''; try { svg = K.render(A.lookFor(p.id), { height: 150, lod: 'lo', scheme: p.scheme, silhouette: true, shadow: false, suffix: '-pb' }).svg; } catch (e) { svg = ''; }
      b.innerHTML = '<div class="word">' + esc(p.name) + '</div><div class="fig">' + svg + '</div><div class="foot"><span class="lt">Core playbook</span> ' + esc(p.ordinal) + ' <span class="lt">of</span> EIGHT</div>';
      var sv = b.querySelector('svg'); if (sv) { sv.removeAttribute('width'); sv.removeAttribute('height'); }
      b.onclick = function () { choosePlaybook(p.id); };
      covers.appendChild(b);
    });
    CT.LOCKED.forEach(function (p) {
      var b = el('button', 'pb'); b.type = 'button'; b.disabled = true; b.style.opacity = '.55'; b.style.cursor = 'default';
      b.style.setProperty('--duo-a', '#c9c3b8'); b.style.setProperty('--duo-b', '#2a2521'); b.style.setProperty('--on-duo', '#fbf8f1');
      b.innerHTML = '<div class="word">' + esc(p.name) + '</div><div class="fig" style="place-items:center;font:900 10px/1.4 var(--font-cond);text-transform:uppercase;letter-spacing:.12em;text-align:center;padding:12px">Paranormal playbook<br>not in this prototype</div><div class="foot">' + esc(p.descriptor) + '</div>';
      covers.appendChild(b);
    });
    var coversC = custom(covers, function () { covers.querySelectorAll('.pb').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.id === S.sheet.playbook)); }); });

    var info = el('div', 'pbinfo');
    var infoC = custom(info, function () {
      var p = pb(); if (!p) { info.innerHTML = '<p class="hint">Pick a playbook. It sets the plate colour, the file code, the starting action dots, the special abilities on offer, and a starting look you can keep or redress.</p>'; info.style.borderLeftColor = 'var(--hair)'; return; }
      info.style.borderLeftColor = p.duo ? p.duo[0] : 'var(--rule)';
      var extra = [];
      if (p.cohort) extra.push('<dt>Cohort</dt><dd>' + esc(p.cohort.label) + '</dd>');
      if (p.backing) extra.push('<dt>Backing</dt><dd>You start with a backing faction</dd>');
      if (p.hull) extra.push('<dt>Drain</dt><dd>Drain instead of Stress; no vice, no keys, no friends. One controller.</dd>');
      if (p.veteran) extra.push('<dt>Scars</dt><dd>Military Discipline plus one ability, one extra action dot, one key already deadlocked</dd>');
      info.innerHTML = '<div class="desc">' + A.kickerHtml(p.descriptor) + '</div><p>' + esc(p.blurb) + '</p><dl><dt>xp</dt><dd>When you play a ' + esc(p.name) + ', you earn xp when you ' + esc(p.xp) + '.</dd><dt>Resource</dt><dd>' + esc(p.resource) + '</dd><dt>Dots</dt><dd>' + p.dots + ' action dots in all, ' + (Object.keys(p.printed).length ? Object.keys(p.printed).map(function (k) { return k + ' ' + p.printed[k]; }).join(', ') + ' printed' : 'none printed') + '</dd>' + extra.join('') + '</dl>';
      if (S.dirty) { var b = el('button', 'btn sm', 'Dress the figure in the ' + esc(p.name) + ' look'); b.type = 'button'; b.style.justifySelf = 'start'; b.onclick = function () { A.applyLook(p.id); }; info.appendChild(b); }
    });
    return [note('Eight core playbooks. Each is a reputation in the underworld, a set of special abilities, and a way of earning xp.'), coversC, infoC];
  }

  /* ---------- 2 · Build ---------- */
  function buildStep() {
    return [
      chips('Figure', 'figure', ['masc', 'fem'], { labels: { masc: 'Masc', fem: 'Fem' }, hint: 'Sets the default rig. Fem figures get a slimmer neck, arms and legs.' }),
      range('Height', 'heightIn', 48, 84, 1, { fmt: function (v) { return A.feet(v) + ' · ' + v + ' in'; }, hint: 'Booker is 6\'5", the Loader 6\'2", Stacey 5\'8", Alfie 5\'5". You stand beside them below.' }),
      chips('Shape language', 'shape', Object.keys(O.shapes), { titles: O.shapes, hint: 'One dominant silhouette. Hover a chip for what it reads as.' }),
      grid(
        range('Build', 'build', 0.85, 1.35, 0.01, { def: 1, fmt: function (v) { return '×' + v.toFixed(2); } }),
        range('Heads tall', 'heads', 6, 8.4, 0.05, { clearAt: 6, fmt: function (v) { return v <= 6 ? 'default for the shape' : v.toFixed(2) + ' heads'; }, hint: '7 to 8 for adults.' }),
        range('Age', 'age', 14, 80, 1, { def: 35, fmt: function (v) { return v + ' years'; }, hint: 'Age lines appear from 40.' }),
        chips('Age style', 'face.ageStyle', ['lines', 'weathered'], { kind: 'age', none: 'Default', visible: function () { return (S.spec.age || 35) >= 40; } })
      ),
      swatches('Skin', 'skin', SKINS),
      grid(
        range('Shoulders', 'body.shoulders', 0.8, 1.4, 0.01, { clearAt: 1, def: 1, fmt: function (v) { return v === 1 ? 'as the shape' : '×' + v.toFixed(2); } }),
        range('Belly', 'body.belly', 0, 1.5, 0.05, { clearAt: 0, fmt: function (v) { return v === 0 ? 'flat' : v.toFixed(2); } }),
        range('Legs', 'body.legs', 0.8, 1.4, 0.01, { clearAt: 1, def: 1, fmt: function (v) { return v === 1 ? 'as the shape' : '×' + v.toFixed(2); } }),
        chips('A big leg', 'body.bigLeg', ['R', 'L'], { none: 'Neither', labels: { R: 'Right', L: 'Left' } })
      )
    ];
  }

  /* ---------- 3 · Face ---------- */
  function markObj(t) { return ((S.spec.face || {}).marks || []).filter(function (m) { return m.type === t; })[0]; }
  function toggleMark(t) {
    var f = S.spec.face = S.spec.face || {}; var ms = f.marks || [];
    if (markObj(t)) ms = ms.filter(function (m) { return m.type !== t; }); else ms.push(t === 'scar' ? { type: 'scar', at: 'cheek-L' } : t === 'plaster' ? { type: 'plaster', at: 'nose' } : t === 'mole' ? { type: 'mole', at: 'cheek-R' } : { type: t });
    f.marks = ms; if (!ms.length) delete f.marks; S.dirty = true; A.changed();
  }
  function faceStep() {
    var marks = field('Marks', 'Scars, plasters, spots, freckles and a beauty mark.'); var row = el('div', 'row'); marks.appendChild(row);
    O.mark.forEach(function (m) { var b = el('button', 'chip', esc(m)); b.type = 'button'; b.dataset.v = m; b.title = A.describe('mark', m); b.onclick = function () { toggleMark(m); }; row.appendChild(b); });
    custom(marks, function () { row.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(!!markObj(b.dataset.v))); }); });
    var at = el('div', 'sub');
    var mk = function (t, label, ats) { var f = field(label); var r = el('div', 'row'); f.appendChild(r); ats.forEach(function (a) { var b = el('button', 'chip sm', esc(a.replace(/-/g, ' '))); b.type = 'button'; b.dataset.v = a; b.onclick = function () { var m = markObj(t); if (m) { m.at = a; S.dirty = true; A.changed(); } }; r.appendChild(b); }); custom(f, function () { var m = markObj(t); r.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(!!m && m.at === b.dataset.v)); }); }, function () { return !!markObj(t); }); return f; };
    at.appendChild(mk('scar', 'Scar runs', ['across', 'brow-R', 'brow-L', 'cheek-R', 'cheek-L', 'lip', 'nose']));
    at.appendChild(mk('plaster', 'Plaster sits', ['nose', 'cheek-L', 'cheek-R', 'brow-L', 'brow-R']));
    at.appendChild(mk('mole', 'Mole sits', ['cheek-L', 'cheek-R', 'lip', 'chin', 'forehead', 'temple']));
    custom(at, null, function () { return !!(markObj('scar') || markObj('plaster') || markObj('mole')); });
    return [
      chips('Head shape', 'head.shape', O.head, { kind: 'head' }),
      grid(chips('Chin', 'head.chin', ['round', 'square', 'pointed', 'cleft'], { none: 'Default' }), chips('Ears', 'head.ears', O.ears, { kind: 'ears' }), range('Jaw', 'head.jaw', 0.8, 1.3, 0.01, { clearAt: 1, def: 1, fmt: function (v) { return v === 1 ? 'default' : '×' + v.toFixed(2); } })),
      chips('Eyes', 'face.eyes', O.eyes, { kind: 'eyes' }),
      chips('Brows', 'face.brows', O.brows, { kind: 'brows' }),
      grid(range('Brow weight', 'face.browWeight', 0.6, 1.5, 0.05, { clearAt: 1, def: 1, fmt: function (v) { return v === 1 ? 'default' : '×' + v.toFixed(2); } }), chips('Brow gap (scar)', 'face.gap', ['R', 'L'], { none: 'None', labels: { R: 'Right brow', L: 'Left brow' } })),
      chips('Nose', 'face.nose', O.nose, { kind: 'nose' }),
      chips('Mouth', 'face.mouth', O.mouth, { kind: 'mouth' }),
      chips('Expression', 'face.expression', O.expression, { kind: 'expression' }),
      chips('Facial hair', 'face.facialHair.type', O.facialHair, { kind: 'facialHair', none: 'Clean-shaven', after: function (n) { if (!n) set('face.facialHair', null); } }),
      group([swatches('Facial hair colour', 'face.facialHair.color', HAIR_TOKENS, { none: 'As the hair' }), toggle('Grey flecks', 'face.facialHair.grey', { onValue: 'ink-300', offValue: null })], function () { return !!get('face.facialHair.type'); }),
      chips('Makeup', 'face.makeup.type', O.makeup, { kind: 'makeup', none: 'None', after: function (n) { if (!n) set('face.makeup', null); } }),
      group([swatches('Lipstick', 'face.makeup.lips', ['cloth-red', 'cloth-brick', 'cloth-oxblood', 'cloth-salmon', 'cloth-pink', 'cloth-magenta', 'cloth-plum'], { none: 'Default' })], function () { return !!get('face.makeup.type'); }),
      chips('Eyewear', 'face.eyewear.type', O.eyewear, { kind: 'eyewear', none: 'None', after: function (n) { if (!n) set('face.eyewear', null); } }),
      group([swatches('Frame', 'face.eyewear.frame', ['cloth-black', 'cloth-chocolate', 'cloth-tobacco', 'metal-brass', 'metal-steel', 'metal-chrome', 'cloth-white', 'cloth-pink', 'cloth-red', 'cloth-cobalt'], { none: 'Default' }), chips('Patched eye', 'face.eyewear.side', ['R', 'L'], { none: 'Default', labels: { R: 'Right', L: 'Left' }, visible: function () { return get('face.eyewear.type') === 'eyepatch'; } })], function () { return !!get('face.eyewear.type'); }),
      marks, at
    ];
  }

  /* ---------- 4 · Hair ---------- */
  function hairStep() {
    return [
      chips('Style', 'hair.style', O.hair, { kind: 'hair' }),
      swatches('Colour', 'hair.color', HAIR_TOKENS, { visible: function () { return get('hair.style') !== 'bald'; } }),
      grid(
        toggle('Grey at the temples', 'hair.grey', { onValue: 'ink-300', offValue: null, visible: function () { return get('hair.style') !== 'bald'; } }),
        chips('Parting', 'hair.part', ['L', 'R'], { none: 'Default', labels: { L: 'Left', R: 'Right' }, visible: function () { return 'part' in A.params('hair', get('hair.style')); } }),
        range('Volume', 'hair.volume', 0.8, 1.4, 0.01, { clearAt: 1, def: 1, fmt: function (v) { return v === 1 ? 'default' : '×' + v.toFixed(2); }, visible: function () { return 'volume' in A.params('hair', get('hair.style')); } }),
        range('Length', 'hair.length', 0.7, 1.3, 0.01, { clearAt: 1, def: 1, fmt: function (v) { return v === 1 ? 'default' : '×' + v.toFixed(2); }, visible: function () { return 'length' in A.params('hair', get('hair.style')); } })
      ),
      chips('Hat', 'hair.hat.type', O.hat, { kind: 'hat', none: 'Bare-headed', after: function (n) { if (!n) set('hair.hat', null); else if (!get('hair.hat.color')) set('hair.hat.color', 'cloth-charcoal'); } }),
      group([swatches('Hat colour', 'hair.hat.color', CLOTH), swatches('Band or stripe', 'hair.hat.band', CLOTH, { none: 'Default', visible: function () { return 'band' in A.params('hat', get('hair.hat.type')); } })], function () { return !!get('hair.hat.type'); })
    ];
  }

  /* ---------- 5 · Wardrobe ---------- */
  function wardrobeStep() {
    return [note('Palette discipline: one dominant colour, one secondary, one small accent. A dress or overalls replaces the shirt and trousers where it covers them.'),
      slot('Base', 'base', 'shirt, tee, turtleneck…'), slot('Mid layer', 'mid', 'waistcoat, cardigan, apron'), slot('Outer', 'outer', 'jackets and coats'), slot('Neck', 'neck', 'tie, scarf, pendant'),
      slot('Bottom', 'bottom', 'trousers, jeans, skirts'), slot('Dress', 'dress', 'a dress, overalls or boiler suit'), slot('Legs', 'legs', 'tights or socks'), slot('Feet', 'feet', 'shoes and boots'), slot('Waist', 'waist', 'a belt'), slot('Hands', 'hands', 'gloves')];
  }

  /* ---------- 6 · Props ---------- */
  var PROP_POSE = { cigarette: 'smoke', pipe: 'smoke', briefcase: 'carry', suitcase: 'carry', glass: 'hold', book: 'hold', newspaper: 'hold', 'rifle-shoulder': 'raise' };
  function hasProp(t) { return (S.spec.props || []).some(function (p) { return p.type === t; }); }
  function propObj(t) { return (S.spec.props || []).filter(function (p) { return p.type === t; })[0]; }
  function toggleProp(t) {
    var ps = S.spec.props || [];
    if (hasProp(t)) S.spec.props = ps.filter(function (p) { return p.type !== t; });
    else { ps.push({ type: t }); S.spec.props = ps; var need = PROP_POSE[t]; if (need) { var arms = (S.spec.pose = S.spec.pose || {}).arms = S.spec.pose.arms || { R: 'down', L: 'down' }; if (arms.R !== need && arms.L !== need) { arms.R = need; if (need === 'raise' && arms.L === 'raise') arms.L = 'hip'; } } }
    S.dirty = true; A.changed();
  }
  function propsStep() {
    var f = field('Props', 'A prop that needs a hand sets the arm pose for it.'); var row = el('div', 'row'); f.appendChild(row);
    O.prop.forEach(function (p) { var b = el('button', 'chip', esc(p.replace(/-/g, ' '))); b.type = 'button'; b.dataset.v = p; b.title = A.describe('prop', p); b.onclick = function () { toggleProp(p); }; row.appendChild(b); });
    custom(f, function () { row.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(hasProp(b.dataset.v))); }); });
    var sides = el('div', 'sub');
    O.prop.filter(function (p) { return 'side' in A.params('prop', p); }).forEach(function (p) {
      var sf = field(p.replace(/-/g, ' ') + ' side'); var r = el('div', 'seg'); sf.appendChild(r);
      ['R', 'L'].forEach(function (s) { var b = el('button', 'chip', s === 'R' ? 'Right' : 'Left'); b.type = 'button'; b.dataset.v = s; b.onclick = function () { var o = propObj(p); if (o) { o.side = s; S.dirty = true; A.changed(); } }; r.appendChild(b); });
      custom(sf, function () { var o = propObj(p); r.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(!!o && (o.side || (p === 'knee-brace' ? 'R' : '')) === b.dataset.v)); }); }, function () { return hasProp(p); });
      sides.appendChild(sf);
    });
    custom(sides, null, function () { return (S.spec.props || []).some(function (p) { return 'side' in A.params('prop', p.type); }); });
    return [f, sides,
      chips('Companion', 'companion.type', O.companion, { kind: 'companion', none: 'None', after: function (n) { if (!n) set('companion', null); else if (n === 'dog' && !get('companion.breed')) { set('companion.breed', 'hound'); set('companion.side', 'L'); set('companion.pose', 'sit'); } } }),
      group([
        chips('Breed', 'companion.breed', ['hound', 'terrier', 'mutt', 'shepherd'], { visible: function () { return get('companion.type') === 'dog'; } }),
        chips('Dog stands at', 'companion.side', ['R', 'L'], { labels: { R: 'Right heel', L: 'Left heel' }, visible: function () { return get('companion.type') === 'dog'; } }),
        chips('Dog pose', 'companion.pose', ['stand', 'sit'], { visible: function () { return get('companion.type') === 'dog'; } }),
        chips('Cat lies on', 'companion.at', ['shoulder-L', 'shoulder-R'], { labels: { 'shoulder-L': 'Left shoulder', 'shoulder-R': 'Right shoulder' }, none: 'Default', visible: function () { return get('companion.type') === 'cat'; } }),
        swatches('Coat', 'companion.color', ['cloth-black', 'cloth-chocolate', 'cloth-tobacco', 'cloth-tan', 'cloth-camel', 'cloth-cream', 'cloth-white', 'cloth-ash', 'cloth-rust', 'cloth-graphite'], { none: 'Default' })
      ], function () { return !!get('companion.type'); })];
  }

  /* ---------- 7 · Pose ---------- */
  function poseStep() {
    var arms = Object.keys(O.armPoses);
    return [
      chips('Stance', 'pose.stance', ['square', 'easy', 'wide'], { titles: { square: 'Feet under the hips, weight even.', easy: 'Weight on one leg, the other easy.', wide: 'Feet planted apart.' } }),
      chips('Weight on', 'pose.weight', ['R', 'L'], { labels: { R: 'Right leg', L: 'Left leg' }, visible: function () { return get('pose.stance') === 'easy'; } }),
      chips('Right arm', 'pose.arms.R', arms, { titles: O.armPoses, hint: 'The character\'s right, on the viewer\'s left.' }),
      chips('Left arm', 'pose.arms.L', arms, { titles: O.armPoses }),
      toggle('Thumbs out of the pockets', 'pose.thumb', { visible: function () { return get('pose.arms.R') === 'pocket' || get('pose.arms.L') === 'pocket'; } }),
      grid(
        range('Head tilt', 'pose.head.tilt', -10, 10, 1, { clearAt: 0, fmt: function (v) { return v === 0 ? 'level' : (v > 0 ? '+' : '') + v + '°'; } }),
        range('Head turn', 'pose.head.yaw', -25, 25, 1, { clearAt: 0, fmt: function (v) { return v === 0 ? 'front-on' : (v > 0 ? '+' : '') + v + '°'; } }),
        range('Stoop', 'pose.stoop', 0, 1, 0.05, { clearAt: 0, fmt: function (v) { return v === 0 ? 'upright' : v.toFixed(2); }, hint: 'For the bent, the old and the furtive.' })
      )
    ];
  }

  /* ---------- 8 · Origins ---------- */
  function originsStep() {
    var her = el('div'); her.appendChild(h3('Heritage'));
    her.appendChild(note('Where your family line is from. Then decide if you immigrated to Doskvol or grew up here.'));
    her.appendChild(chips('', 'sheet.heritage', CT.HERITAGES.map(function (h) { return h.name; }), { text: true }));
    var hinfo = el('div', 'sub'); custom(hinfo, function () { var h = CT.HERITAGES.filter(function (x) { return x.name === S.sheet.heritage; })[0]; hinfo.innerHTML = h ? '<p>' + esc(h.blurb) + '</p><p class="hint"><b>Family examples:</b> ' + esc(h.examples) + '</p>' : ''; }, function () { return !!S.sheet.heritage; });
    her.appendChild(hinfo);
    her.appendChild(text('A detail about your family life', 'sheet.heritageDetail', { placeholder: 'e.g. Union-strong factory workers in Coalridge', visible: function () { return !!S.sheet.heritage; } }));
    custom(her, null, function () { return hasPb() && !hull(); });

    var bg = el('div'); bg.appendChild(h3('Background'));
    bg.appendChild(note('What you did before you joined the crew. Choose one, then write something specific.'));
    bg.appendChild(chips('', 'sheet.background', CT.BACKGROUNDS.map(function (b) { return b.name; }), { text: true }));
    var binfo = el('div', 'sub'); custom(binfo, function () { var b = CT.BACKGROUNDS.filter(function (x) { return x.name === S.sheet.background; })[0]; binfo.innerHTML = b ? '<p class="hint"><b>For example:</b> ' + esc(b.examples) + '</p>' : ''; }, function () { return !!S.sheet.background; });
    bg.appendChild(binfo);
    bg.appendChild(text('A specific detail', 'sheet.backgroundDetail', { placeholder: 'e.g. Short order cook, recently fired', visible: function () { return !!S.sheet.background; } }));
    custom(bg, null, function () { var p = pb(); return !!p && !p.hull && !p.altBackground; });

    var alt = el('div'); var altTitle = h3(''); alt.appendChild(altTitle); var altNote = note(''); alt.appendChild(altNote);
    var altBox = el('div'); alt.appendChild(altBox);
    var altBuilt = null;
    custom(alt, function () {
      var p = pb(); if (!p || !p.altBackground) return; var a = p.altBackground;
      altTitle.textContent = a.label; altNote.textContent = a.text;
      if (altBuilt !== p.id) { altBuilt = p.id; altBox.innerHTML = ''; altBox.appendChild(altCtl(a)); A.syncAll(); }
    }, function () { var p = pb(); return !!p && !!p.altBackground; });
    function altCtl(a) { var f = field(''); var row = el('div', 'row'); f.appendChild(row); a.options.forEach(function (name) { var b = el('button', 'chip txt', esc(name)); b.type = 'button'; b.dataset.v = name; b.onclick = function () { var cur = (S.sheet.alt || []).slice(); if (a.multi) { var i = cur.indexOf(name); if (i >= 0) cur.splice(i, 1); else cur.push(name); } else cur = [name]; set('sheet.alt', cur); }; row.appendChild(b); }); custom(f, function () { var v = S.sheet.alt || []; row.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(v.indexOf(b.dataset.v) >= 0)); }); }); return f; }
    alt.appendChild(text('A specific detail', 'sheet.backgroundDetail', { placeholder: 'How, where, with whom' }));

    var own = el('div'); own.appendChild(h3('Owning faction')); own.appendChild(note('You lead a double life. Some of the time you do the work of a laboring automaton for an owning faction; the rest of the time you live free and remember who you were.'));
    own.appendChild(chips('', 'sheet.owning', CT.byId.hull.owning, { text: true }));
    own.appendChild(text('How do you hide your double life from them?', 'sheet.heritageDetail', { multi: true, placeholder: 'One more machine overlooked in the multitude, or a personal arrangement with your controller?' }));
    custom(own, null, hull);

    var none = note('Pick a playbook first.'); custom(none, null, function () { return !hasPb(); });
    return [none, her, bg, alt, own];
  }

  /* ---------- 9 · Actions ---------- */
  function dotsTotal() { var t = 0; var d = S.sheet.dots || {}; Object.keys(d).forEach(function (k) { t += d[k] || 0; }); return t; }
  A.dotsTotal = dotsTotal;
  function attrRating(actions) { var d = S.sheet.dots || {}; return actions.filter(function (a) { return (d[a] || 0) > 0; }).length; }
  A.attrRating = attrRating;
  function actionsStep() {
    var intro = el('div'); custom(intro, function () { var p = pb(); if (!p) { intro.innerHTML = '<p class="hint">Pick a playbook first.</p>'; return; } var printed = Object.keys(p.printed).map(function (k) { return k + ' ' + p.printed[k]; }).join(', '); intro.innerHTML = '<p class="hint">' + (p.hull ? 'Hulls start with no heritage or background, so assign four dots wherever you want: six in all.' : p.veteran ? 'Four dots as usual, plus one more: eight in all.' : 'Add one dot for your heritage, one for your background, and two more: seven in all.') + ' No action may start above 2. ' + (printed ? 'The sheet prints ' + esc(printed) + ', marked in orange.' : '') + ' An attribute’s rating is the number of its actions with at least one dot.</p>'; });
    var budget = el('div', 'budget'); custom(budget, function () { var p = pb(); if (!p) return; var t = dotsTotal(); budget.textContent = t + ' / ' + p.dots + ' dots placed'; budget.className = 'budget' + (t > p.dots ? ' bad' : ''); });
    var box = el('div', 'dots');
    CT.ACTIONS.forEach(function (grp) {
      var a = el('div', 'attr'); var ah = el('div', 'ah'); ah.innerHTML = '<span class="kicker"><b>' + esc(grp[0]) + '</b></span><span class="rating"></span>'; a.appendChild(ah);
      grp[1].forEach(function (name) {
        var r = el('div', 'act'); r.innerHTML = '<span class="nm">' + esc(name) + '</span>'; var pips = el('span', 'pips'); r.appendChild(pips);
        for (var i = 1; i <= 3; i++) (function (n) { var b = el('button', 'pip'); b.type = 'button'; b.dataset.n = n; b.setAttribute('aria-label', name + ' ' + n); b.onclick = function () { var d = S.sheet.dots = S.sheet.dots || {}; var cur = d[name] || 0; d[name] = (cur === n) ? n - 1 : n; A.changed(); }; pips.appendChild(b); })(i);
        custom(r, function () { var p = pb(); var d = S.sheet.dots || {}; var v = d[name] || 0; var pr = p ? (p.printed[name] || 0) : 0; pips.querySelectorAll('.pip').forEach(function (b) { var n = +b.dataset.n; b.className = 'pip' + (n <= v ? ' on' : '') + (n <= pr ? ' printed' : '') + (n === 3 && v >= 3 ? ' over' : ''); }); });
        a.appendChild(r);
      });
      custom(a, function () { ah.querySelector('.rating').textContent = 'rating ' + attrRating(grp[1]); }, hasPb);
      box.appendChild(a);
    });
    var reset = el('button', 'btn sm', 'Back to the printed dots'); reset.type = 'button'; reset.onclick = function () { var p = pb(); if (p) { S.sheet.dots = clone(p.printed); A.changed(); } };
    custom(reset, null, hasPb);
    return [intro, custom(budget, null, hasPb), box, reset];
  }

  /* ---------- 10 · Abilities ---------- */
  function abilityCard(name, txt, opts) {
    opts = opts || {}; var b = el('button', 'ab' + (opts.fixed ? ' fixed' : '')); b.type = 'button'; b.innerHTML = '<span class="box"></span><span><span class="nm">' + esc(name) + '</span> <span class="tx">' + esc(txt) + '</span></span>';
    if (opts.fixed) b.setAttribute('aria-pressed', 'true'); else b.onclick = opts.onclick;
    return b;
  }
  function abilitiesStep() {
    var intro = el('div'); custom(intro, function () { var p = pb(); if (!p) { intro.innerHTML = '<p class="hint">Pick a playbook first.</p>'; return; } intro.innerHTML = '<p class="hint">' + (p.hull ? 'You start with Automaton. Pick one more Hull trait, and two frame features.' : p.veteran ? 'You start with Military Discipline. Pick one more special ability.' : 'Choose one special ability. If you can’t decide, take the first on the list.') + '</p>'; });
    var list = el('div', 'abil'); var built = null;
    custom(list, function () {
      var p = pb(); if (!p) { list.innerHTML = ''; built = null; return; }
      if (built === p.id) { list.querySelectorAll('.ab:not(.fixed)').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.n === S.sheet.ability)); }); return; }
      built = p.id; list.innerHTML = '';
      if (p.hull) list.appendChild(abilityCard('Automaton', 'You are a soul powering a robotic body. Human-like strength and senses; built-in armor that doesn’t count for load; you may be repaired if damaged or destroyed. Whenever you would take Stress, take Drain instead. Choose two frame features.', { fixed: true }));
      if (p.fixedAbility) list.appendChild(abilityCard(p.fixedAbility[0], p.fixedAbility[1], { fixed: true }));
      p.abilities.forEach(function (ab) { var b = abilityCard(ab[0], ab[1], { onclick: function () { set('sheet.ability', S.sheet.ability === ab[0] ? null : ab[0]); } }); b.dataset.n = ab[0]; list.appendChild(b); });
      list.querySelectorAll('.ab:not(.fixed)').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.n === S.sheet.ability)); });
    });
    var versatile = text('Versatile: an ability from another source, written in', 'sheet.customAbility', { placeholder: 'Name and rule text, if the table allows it', visible: hasPb });
    var frame = el('div'); frame.appendChild(h3('Frame features')); frame.appendChild(note('You begin with two frame features of your choice.'));
    var fl = el('div', 'abil'); CT.byId.hull.frame.forEach(function (f) { var b = abilityCard(f[0], f[1], { onclick: function () { var cur = (S.sheet.frame || []).slice(); var i = cur.indexOf(f[0]); if (i >= 0) cur.splice(i, 1); else if (cur.length < 2) cur.push(f[0]); set('sheet.frame', cur); } }); b.dataset.n = f[0]; fl.appendChild(b); });
    custom(fl, function () { fl.querySelectorAll('.ab').forEach(function (b) { b.setAttribute('aria-pressed', String((S.sheet.frame || []).indexOf(b.dataset.n) >= 0)); }); });
    frame.appendChild(fl); custom(frame, null, hull);

    var cohort = el('div'); var ct = h3(''); cohort.appendChild(ct); var cn = note(''); cohort.appendChild(cn);
    cohort.appendChild(grid(text('Name', 'sheet.cohortName', { placeholder: 'What do you call them?' }), text('Edges', 'sheet.cohortEdges', { placeholder: 'e.g. Fearless, Loyal' }), text('Flaws', 'sheet.cohortFlaws', { placeholder: 'e.g. Wild, Savage' })));
    var ctype = el('div'); cohort.appendChild(ctype); var ctBuilt = null;
    custom(cohort, function () { var p = pb(); if (!p || !p.cohort) return; ct.textContent = p.cohort.label; cn.textContent = p.cohort.text; if (ctBuilt !== p.id) { ctBuilt = p.id; ctype.innerHTML = ''; ctype.appendChild(chips(p.cohort.housing ? 'Type' : 'What kind', 'sheet.cohortType', p.cohort.types, { text: true })); if (p.cohort.housing) ctype.appendChild(chips('Housing', 'sheet.cohortHousing', p.cohort.housing, { text: true })); A.syncAll(); } }, function () { var p = pb(); return !!p && !!p.cohort; });

    var backing = el('div'); backing.appendChild(h3('Backing faction')); backing.appendChild(note('Other playbooks have to unlock a backing faction; you start with one. Did they train you, recruit you, or are you a disposable asset?'));
    backing.appendChild(chips('', 'sheet.backing', CT.byId.operative.backing, { text: true }));
    backing.appendChild(text('Personal mission', 'sheet.mission', { placeholder: 'Complete it to gain the faction’s prestige ability' }));
    custom(backing, null, function () { var p = pb(); return !!p && !!p.backing; });

    var scars = el('div'); scars.appendChild(h3('Used and discarded'));
    scars.appendChild(grid(text('Damage', 'sheet.damage', { multi: true, placeholder: 'Burns, shrapnel, a missing eye or limb, tinnitus, nightmares, the shakes' }), text('Something that helps', 'sheet.helps', { multi: true, placeholder: 'A wheelchair, a prosthetic, medication, a cane, a service animal' })));
    custom(scars, null, vet);

    var expl = el('div'); expl.appendChild(h3('Explosives')); expl.appendChild(note('When you use a bandolier slot, choose an explosive. Fine items, Quality crew Tier +1. Explosives on a score add +1 Heat.'));
    expl.appendChild(el('p', null, esc(CT.byId.radical.explosives.join(' · '))));
    custom(expl, null, function () { var p = pb(); return !!p && !!p.explosives; });
    return [intro, list, versatile, frame, cohort, backing, scars, expl];
  }

  /* ---------- 11 · Keys ---------- */
  function keyName(k) { return k.split(' (')[0]; }
  function keyParts(k) { var m = k.match(/\(▼ (.*?) ▲ (.*?)\)/); return m ? [m[1], m[2]] : ['', '']; }
  function keysStep() {
    var intro = el('div'); custom(intro, function () { var p = pb(); intro.innerHTML = !p ? '<p class="hint">Pick a playbook first.</p>' : p.hull ? '<p class="hint">You start with no keys. Hit your xp triggers to keep up. If you have no keys yet, choose a robotic deadlock instead when you would deadlock a key: ' + esc(p.roboticDeadlocks.join(', ')) + '.</p>' : '<p class="hint">Keys are personality traits central to who you are. Up to four; start with two or three. Each lists two deadlocks: ▼ reversed, ▲ intensified. <b>Hard mode is on at this table: a deadlock is permanent.</b>' + (p.veteran ? ' As a Veteran you start with one key already deadlocked.' : '') + '</p>'; });
    var box = el('div', 'keys'); var built = null;
    custom(box, function () {
      var p = pb(); if (!p || p.hull) { box.innerHTML = ''; built = null; return; }
      if (built !== p.id) { built = p.id; box.innerHTML = ''; p.keys.forEach(function (k) { var b = el('button', 'key'); b.type = 'button'; b.dataset.k = k; var ps = keyParts(k); b.innerHTML = '<b>' + esc(keyName(k)) + '</b> <small>▼ ' + esc(ps[0]) + ' ▲ ' + esc(ps[1]) + '</small>'; b.onclick = function () { var cur = (S.sheet.keys || []).slice(); var i = cur.indexOf(k); if (i >= 0) cur.splice(i, 1); else if (cur.length < 4) cur.push(k); set('sheet.keys', cur); }; box.appendChild(b); }); }
      box.querySelectorAll('.key').forEach(function (b) { b.setAttribute('aria-pressed', String((S.sheet.keys || []).indexOf(b.dataset.k) >= 0)); });
    });
    var ownKey = text('A key of your own', 'sheet.customKey', { placeholder: 'Hopeful (▼ Cynical ▲ Content)', hint: 'Written in the same form so its deadlocks are ready.', visible: function () { return hasPb() && !hull(); } });
    var dead = el('div'); dead.appendChild(h3('The deadlocked key')); dead.appendChild(note('Choose both the key and its deadlocked state.'));
    var dk = el('div', 'row'); dead.appendChild(dk); var dm = el('div', 'row'); dead.appendChild(dm);
    custom(dead, function () {
      var keys = (S.sheet.keys || []).concat(S.sheet.customKey ? [S.sheet.customKey] : []);
      dk.innerHTML = ''; keys.forEach(function (k) { var b = el('button', 'chip txt', esc(keyName(k))); b.type = 'button'; b.setAttribute('aria-pressed', String(S.sheet.deadlockKey === k)); b.onclick = function () { set('sheet.deadlockKey', k); }; dk.appendChild(b); });
      if (!keys.length) dk.innerHTML = '<span class="hint">Choose your keys above first.</span>';
      dm.innerHTML = ''; if (S.sheet.deadlockKey) { var ps = keyParts(S.sheet.deadlockKey); [['▼', ps[0]], ['▲', ps[1]]].forEach(function (m) { var b = el('button', 'chip txt', m[0] + ' ' + esc(m[1] || 'deadlock')); b.type = 'button'; b.setAttribute('aria-pressed', String(S.sheet.deadlockMode === m[0])); b.onclick = function () { set('sheet.deadlockMode', m[0]); }; dm.appendChild(b); }); }
    }, vet);
    return [intro, box, ownKey, dead];
  }

  /* ---------- 12 · Contacts ---------- */
  function contactsStep() {
    var intro = el('div'); custom(intro, function () { var p = pb(); intro.innerHTML = !p ? '<p class="hint">Pick a playbook first.</p>' : '<p class="hint">' + esc(p.friendsRule || 'Choose one close friend (▲) and one rival (▼). Click a dot to cycle it.') + '</p>'; });
    var list = el('div'); var built = null;
    custom(list, function () {
      var p = pb(); if (!p) { list.innerHTML = ''; built = null; return; }
      if (built !== p.id) { built = p.id; list.innerHTML = ''; p.contacts.forEach(function (c) { var r = el('div', 'contact'); var d = el('button', 'dot'); d.type = 'button'; d.dataset.n = c[0]; d.setAttribute('aria-label', 'Cycle ' + c[0]); d.onclick = function () { var cur = S.sheet.contacts || {}; var v = cur[c[0]]; cur[c[0]] = !v ? 'friend' : v === 'friend' ? 'rival' : null; if (!cur[c[0]]) delete cur[c[0]]; set('sheet.contacts', cur); }; r.appendChild(d); r.appendChild(el('span', null, '<span class="cn">' + esc(c[0]) + '</span>, <span class="cr">' + esc(c[1]) + '</span>')); r.appendChild(el('span', 'st')); list.appendChild(r); }); }
      list.querySelectorAll('.contact').forEach(function (r) { var d = r.querySelector('.dot'); var v = (S.sheet.contacts || {})[d.dataset.n]; d.className = 'dot' + (v ? ' ' + v : ''); r.querySelector('.st').textContent = v === 'friend' ? '▲ friend' : v === 'rival' ? '▼ rival' : ''; });
    });
    var custom1 = text('A contact of your own', 'sheet.contactCustom', { placeholder: 'Name, what they do, and whether friend or rival', visible: hasPb });
    var hullNote = note('Your controller gives you orders and sets you to work. Name them, and decide what they are like.'); custom(hullNote, null, hull);
    return [intro, hullNote, list, custom1];
  }

  /* ---------- 13 · Vice ---------- */
  function viceStep() {
    var intro = el('div'); custom(intro, function () { var p = pb(); intro.innerHTML = !p ? '<p class="hint">Pick a playbook first.</p>' : p.hull ? '<p class="hint">You do not Indulge Vice. Recharge your capacitors by connecting to an industrial-grade generator in downtime: clear 5 Drain.</p>' : '<p class="hint">The purveyor is the part people skip and the part that generates fiction. Pick one from the book or name your own.</p>'; });
    var vices = chips('Vice', 'sheet.vice', CT.VICES.map(function (v) { return v.name; }), { text: true, visible: function () { return hasPb() && !hull(); }, after: function () { set('sheet.purveyor', null); } });
    var vinfo = el('div', 'sub'); var prow = el('div', 'row'); vinfo.appendChild(prow);
    custom(vinfo, function () { var v = CT.VICES.filter(function (x) { return x.name === S.sheet.vice; })[0]; prow.innerHTML = ''; if (!v) return; var b0 = el('p', 'hint', esc(v.blurb)); b0.style.flexBasis = '100%'; prow.appendChild(b0); v.purveyors.forEach(function (pv) { var b = el('button', 'chip txt', esc(pv)); b.type = 'button'; b.setAttribute('aria-pressed', String(S.sheet.purveyor === pv)); b.onclick = function () { set('sheet.purveyor', pv); }; prow.appendChild(b); }); }, function () { return !!S.sheet.vice && !hull(); });
    var own = text('Or a purveyor of your own', 'sheet.purveyor', { placeholder: 'Name, place, district', visible: function () { return !!S.sheet.vice && !hull(); } });
    return [intro, vices, vinfo, own];
  }

  /* ---------- 14 · Items ---------- */
  function itemLoad(name) { var p = pb(); var all = (p ? p.items : []).concat(CT.STANDARD_ITEMS); var it = all.filter(function (i) { return i[0] === name; })[0]; return it ? it[1] : 0; }
  function loadTotal() { return (S.sheet.items || []).reduce(function (t, n) { return t + itemLoad(n); }, 0); }
  A.loadTotal = loadTotal;
  function itemsStep() {
    var intro = note('Load is chosen per score: 3 for a Quiet approach, 6 for Loud. Tick what you expect to carry; the sheet is the final word at the table.');
    var budget = el('div', 'budget'); custom(budget, function () { var t = loadTotal(); budget.textContent = t + ' load · ' + (t <= 3 ? 'quiet' : t <= 6 ? 'loud' : 'over the loud limit'); budget.className = 'budget' + (t > 6 ? ' bad' : ''); }, hasPb);
    function listOf(title, getItems) { var w = el('div'); w.appendChild(h3(title)); var box = el('div', 'items'); w.appendChild(box); var built = null; custom(w, function () { var p = pb(); if (!p) return; var key = p.id + title; if (built !== key) { built = key; box.innerHTML = ''; getItems(p).forEach(function (it) { var b = el('button', 'item'); b.type = 'button'; b.dataset.n = it[0]; b.innerHTML = '<span class="box"></span><span>' + esc(it[0]) + '</span><span class="ld">' + (it[1] ? it[1] + ' load' : '0 load') + '</span>'; b.onclick = function () { var cur = (S.sheet.items || []).slice(); var i = cur.indexOf(it[0]); if (i >= 0) cur.splice(i, 1); else cur.push(it[0]); set('sheet.items', cur); }; box.appendChild(b); }); } box.querySelectorAll('.item').forEach(function (b) { b.setAttribute('aria-pressed', String((S.sheet.items || []).indexOf(b.dataset.n) >= 0)); }); }, hasPb); return w; }
    return [intro, budget, listOf('Playbook items', function (p) { return p.items; }), listOf('Standard items', function () { return CT.STANDARD_ITEMS; })];
  }

  /* ---------- 15 · Identity ---------- */
  function syncNameToSpec() {
    var n = S.sheet.name || ''; S.spec.name = n;
    if (n) { var parts = n.trim().split(/\s+/); var sur = parts[parts.length - 1]; var ini = parts[0][0]; S.spec.plate = hull() ? n : (parts.length > 1 ? sur + ' · ' + ini + '.' : n); S.spec.id = A.slug(n); }
  }
  function describeFigure() {
    var s = S.spec, o = s.outfit || {}, bits = [];
    bits.push(A.feet(s.heightIn || 70)); if (s.shape) bits.push(O.shapes[s.shape] ? s.shape : s.shape); if (s.age) bits.push(s.age + ' years');
    if (s.hair && s.hair.style && s.hair.style !== 'bald') bits.push(s.hair.style.replace(/-/g, ' ') + ' hair'); else if (s.hair && s.hair.style === 'bald') bits.push('bald');
    if (s.face && s.face.facialHair) bits.push(s.face.facialHair.type.replace(/-/g, ' '));
    if (s.face && s.face.eyewear) bits.push(s.face.eyewear.type.replace(/-/g, ' '));
    ((s.face || {}).marks || []).forEach(function (m) { bits.push(m.type + (m.at ? ' ' + m.at.replace(/-/g, ' ') : '')); });
    ['outer', 'dress', 'base', 'mid', 'neck', 'bottom', 'feet'].forEach(function (k) { var g = o[k]; if (g && g.type) bits.push((g.color || '').replace(/^cloth-/, '').replace(/-/g, ' ') + ' ' + g.type.replace(/-/g, ' ')); });
    if (s.hair && s.hair.hat) bits.push(s.hair.hat.type.replace(/-/g, ' '));
    (s.props || []).forEach(function (p) { bits.push(p.type.replace(/-/g, ' ')); });
    if (s.companion) bits.push('a ' + (s.companion.breed || s.companion.type));
    return bits.join(', ');
  }
  function identityStep() {
    var nm = text('Name', 'sheet.name', { placeholder: 'Who is this?', after: function () { syncNameToSpec(); }, button: 'Suggest a name', onButton: function () { var n = hull() ? pick(CT.NAMES.hull) : pick(CT.NAMES.first) + ' ' + pick(CT.NAMES.family); set('sheet.name', n); syncNameToSpec(); A.changed(); } });
    var al = text('Alias', 'sheet.alias', { placeholder: 'What the crew calls you', button: 'Suggest an alias', onButton: function () { set('sheet.alias', pick(CT.NAMES.alias)); } });
    var code = text('File code', 'code', { mono: true, placeholder: 'XXX-968-0000', hint: 'Three letters for the playbook, then 968, then a number. Printed on the mugshot plate.' });
    var look = text('Look', 'sheet.look', { multi: true, placeholder: 'A line or two the table will remember', button: 'Describe the figure', onButton: function () { set('sheet.look', describeFigure()); } });
    var words = el('div'); words.appendChild(h3('Words from the Look page'));
    var wg = el('div', 'wgroups');
    var lists = [['Build', CT.LOOK.build], ['Manner', CT.LOOK.manner], ['Features', CT.LOOK.features], ['Hair', CT.LOOK.hair]];
    lists.forEach(function (l) { var g = el('div', 'g'); g.appendChild(el('div', 'label', esc(l[0]))); var r = el('div', 'row'); l[1].forEach(function (w) { var b = el('button', 'chip txt sm', esc(w)); b.type = 'button'; b.onclick = function () { var cur = S.sheet.look || ''; set('sheet.look', cur ? cur.replace(/\.?\s*$/, '') + ', ' + w.toLowerCase() : w); }; r.appendChild(b); }); g.appendChild(r); wg.appendChild(g); });
    words.appendChild(wg);
    var hl = el('div', 'g'); hl.appendChild(el('div', 'label', 'Hull looks')); var hr = el('div', 'row'); CT.LOOK.hullLook.forEach(function (w) { var b = el('button', 'chip txt sm', esc(w)); b.type = 'button'; b.onclick = function () { var cur = S.sheet.look || ''; set('sheet.look', cur ? cur.replace(/\.?\s*$/, '') + ', ' + w : w); }; hr.appendChild(b); }); hl.appendChild(hr); custom(hl, null, hull); words.appendChild(hl);
    var wear = el('div'); wear.appendChild(h3('Wearing')); var wgr = el('div', 'wgroups');
    CT.LOOK.wearing.forEach(function (l) { var g = el('div', 'g'); g.appendChild(el('div', 'label', esc(l[0]))); var r = el('div', 'row'); l[1].forEach(function (w) { var b = el('button', 'chip txt sm', esc(w)); b.type = 'button'; b.dataset.w = w; b.onclick = function () { var cur = (S.sheet.wearing || []).slice(); var i = cur.indexOf(w); if (i >= 0) cur.splice(i, 1); else cur.push(w); set('sheet.wearing', cur); }; r.appendChild(b); }); g.appendChild(r); wgr.appendChild(g); });
    custom(wgr, function () { wgr.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String((S.sheet.wearing || []).indexOf(b.dataset.w) >= 0)); }); });
    wear.appendChild(wgr);
    return [grid(nm, al), code, look, words, wear];
  }

  /* ---------- 16 · File ---------- */
  function validate() {
    var p = pb(), out = []; var ok = function (c, t) { out.push({ ok: !!c, text: t }); };
    ok(p, 'A playbook is chosen'); if (!p) return out;
    ok(S.sheet.name, 'The subject has a name');
    if (p.hull) ok(S.sheet.owning, 'An owning faction'); else { ok(S.sheet.heritage, 'A heritage'); ok(p.altBackground ? (S.sheet.alt || []).length : S.sheet.background, p.altBackground ? p.altBackground.label : 'A background'); }
    var t = dotsTotal(); var over = Object.keys(S.sheet.dots || {}).some(function (k) { return S.sheet.dots[k] > 2; });
    ok(t === p.dots && !over, 'Action dots: ' + t + ' of ' + p.dots + ' placed' + (over ? ', one is above 2' : ''));
    ok(S.sheet.ability || S.sheet.customAbility, p.hull ? 'One Hull trait beyond Automaton' : p.veteran ? 'One ability beyond Military Discipline' : 'One special ability');
    if (p.hull) ok((S.sheet.frame || []).length === 2, 'Two frame features');
    if (!p.hull) { var kc = (S.sheet.keys || []).length + (S.sheet.customKey ? 1 : 0); ok(kc >= 2 && kc <= 4, 'Two to four keys (' + kc + ')'); }
    if (p.veteran) ok(S.sheet.deadlockKey && S.sheet.deadlockMode, 'One key already deadlocked');
    if (!p.hull) { var c = S.sheet.contacts || {}; var f = Object.keys(c).filter(function (k) { return c[k] === 'friend'; }).length, r = Object.keys(c).filter(function (k) { return c[k] === 'rival'; }).length; ok(f >= (p.friendsNeeded || 1) && r >= 1, (p.friendsNeeded || 1) + ' friend' + ((p.friendsNeeded || 1) > 1 ? 's' : '') + ' and a rival (' + f + ' / ' + r + ')'); }
    if (!p.hull) ok(S.sheet.vice && S.sheet.purveyor, 'A vice with a named purveyor');
    if (p.cohort) ok(S.sheet.cohortType, p.cohort.label + ' has a type');
    if (p.backing) ok(S.sheet.backing, 'A backing faction');
    ok(!(A.lastWarnings || []).length, 'The figure draws clean');
    return out;
  }
  A.validate = validate;
  function sheetMarkdown() {
    var p = pb(); if (!p) return ''; var sh = S.sheet, L = [];
    L.push('# ' + (sh.name || 'Unnamed') + (sh.alias ? ' “' + sh.alias + '”' : '') + ' · ' + p.name);
    L.push(p.descriptor + ' · ' + (S.spec.code || ''));
    L.push(''); L.push('- Look: ' + (sh.look || '')); if ((sh.wearing || []).length) L.push('- Wearing: ' + sh.wearing.join(', '));
    if (p.hull) L.push('- Owning faction: ' + (sh.owning || '')); else { L.push('- Heritage: ' + (sh.heritage || '') + (sh.heritageDetail ? ' — ' + sh.heritageDetail : '')); L.push('- ' + (p.altBackground ? p.altBackground.label : 'Background') + ': ' + (p.altBackground ? (sh.alt || []).join(', ') : (sh.background || '')) + (sh.backgroundDetail ? ' — ' + sh.backgroundDetail : '')); }
    L.push(''); L.push('## Actions'); CT.ACTIONS.forEach(function (g) { L.push('- ' + g[0] + ' ' + attrRating(g[1]) + ': ' + g[1].map(function (a) { return a + ' ' + ((sh.dots || {})[a] || 0); }).join(', ')); });
    L.push(''); L.push('## Special abilities'); if (p.hull) L.push('- Automaton'); if (p.fixedAbility) L.push('- ' + p.fixedAbility[0]); if (sh.ability) L.push('- ' + sh.ability); if (sh.customAbility) L.push('- ' + sh.customAbility); if ((sh.frame || []).length) L.push('- Frame features: ' + sh.frame.join(', '));
    if (p.cohort) L.push('- ' + p.cohort.label + ': ' + [sh.cohortName, sh.cohortType, sh.cohortHousing].filter(Boolean).join(', ') + (sh.cohortEdges ? ' · edges: ' + sh.cohortEdges : '') + (sh.cohortFlaws ? ' · flaws: ' + sh.cohortFlaws : ''));
    if (p.backing) L.push('- Backing faction: ' + (sh.backing || '') + (sh.mission ? ' · mission: ' + sh.mission : ''));
    if (p.veteran) { L.push('- Damage: ' + (sh.damage || '')); L.push('- Something that helps: ' + (sh.helps || '')); }
    if (!p.hull) { L.push(''); L.push('## Keys'); (sh.keys || []).concat(sh.customKey ? [sh.customKey] : []).forEach(function (k) { L.push('- ' + k + (sh.deadlockKey === k ? ' · DEADLOCKED ' + (sh.deadlockMode || '') : '')); }); }
    L.push(''); L.push('## Contacts'); Object.keys(sh.contacts || {}).forEach(function (k) { L.push('- ' + (sh.contacts[k] === 'friend' ? '▲' : '▼') + ' ' + k); }); if (sh.contactCustom) L.push('- ' + sh.contactCustom);
    if (!p.hull) { L.push(''); L.push('## Vice'); L.push('- ' + (sh.vice || '') + (sh.purveyor ? ' · ' + sh.purveyor : '')); }
    L.push(''); L.push('## Items (' + loadTotal() + ' load)'); (sh.items || []).forEach(function (i) { L.push('- ' + i); });
    L.push(''); L.push('## Figure spec'); L.push('```json'); L.push(JSON.stringify(S.spec)); L.push('```');
    return L.join('\n');
  }
  A.sheetMarkdown = sheetMarkdown;
  function fileStep() {
    var checks = el('div', 'checks'); custom(checks, function () { checks.innerHTML = validate().map(function (c) { return '<div class="check ' + (c.ok ? 'ok' : 'bad') + '"><span class="m">' + (c.ok ? '✓' : '✗') + '</span><span>' + esc(c.text) + '</span></div>'; }).join(''); });
    var stamp = el('div'); custom(stamp, function () { var v = validate(); var all = v.every(function (c) { return c.ok; }); stamp.innerHTML = '<span class="stamp"><span>' + (all ? 'Ready to file' : 'Incomplete') + '</span><span class="mono">' + esc(S.spec.code || 'XXX-968-0000') + '</span></span>'; stamp.querySelector('.stamp').style.borderColor = all ? 'var(--ok)' : 'var(--alarm)'; stamp.querySelector('.stamp').style.color = all ? 'var(--ok)' : 'var(--alarm)'; });
    var summary = el('dl', 'summary'); custom(summary, function () {
      var p = pb(), sh = S.sheet; if (!p) { summary.innerHTML = ''; return; }
      var rows = [['Name', (sh.name || '—') + (sh.alias ? ' “' + sh.alias + '”' : '')], ['Playbook', p.name], ['Heritage', p.hull ? 'Owned by ' + (sh.owning || '—') : (sh.heritage || '—') + (sh.heritageDetail ? ', ' + sh.heritageDetail : '')], [p.altBackground ? p.altBackground.label : 'Background', p.hull ? '—' : ((p.altBackground ? (sh.alt || []).join(', ') : sh.background) || '—') + (sh.backgroundDetail ? ', ' + sh.backgroundDetail : '')],
        ['Actions', CT.ACTIONS.map(function (g) { return g[0] + ' ' + attrRating(g[1]); }).join(' · ') + ' · ' + Object.keys(sh.dots || {}).filter(function (k) { return sh.dots[k]; }).map(function (k) { return k + ' ' + sh.dots[k]; }).join(', ')],
        ['Ability', [p.hull ? 'Automaton' : null, p.fixedAbility ? p.fixedAbility[0] : null, sh.ability, sh.customAbility].filter(Boolean).join(', ') || '—'],
        ['Keys', p.hull ? 'none to start' : ((sh.keys || []).map(keyName).concat(sh.customKey ? [keyName(sh.customKey)] : []).join(', ') || '—') + (sh.deadlockKey ? ' · ' + keyName(sh.deadlockKey) + ' deadlocked ' + (sh.deadlockMode || '') : '')],
        ['Contacts', Object.keys(sh.contacts || {}).map(function (k) { return (sh.contacts[k] === 'friend' ? '▲ ' : '▼ ') + k; }).join(', ') || '—'],
        ['Vice', p.hull ? 'Drain and Fuel' : (sh.vice || '—') + (sh.purveyor ? ', ' + sh.purveyor : '')],
        ['Items', ((sh.items || []).join(', ') || '—') + ' · ' + loadTotal() + ' load']];
      summary.innerHTML = rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
    });
    var qs = el('div'); custom(qs, function () { var p = pb(); if (!p || !p.questions.length) { qs.innerHTML = ''; return; } qs.innerHTML = '<h3>Questions for the table</h3><p class="hint">After crew creation, take turns asking the group one of these. Anyone can answer.</p><ul class="qs">' + p.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>'; });
    var ex = el('div', 'exports'); ex.innerHTML = '<button class="btn primary" id="fileRoster" type="button">File this character</button><button class="btn sm" id="dlSvg" type="button">Save figure SVG</button><button class="btn sm" id="dlMug" type="button">Save mugshot SVG</button><button class="btn sm" id="dlPng" type="button">Save PNG</button><button class="btn sm" id="copySheet" type="button">Copy sheet</button><button class="btn sm" id="copySpec" type="button">Copy spec</button><button class="btn sm" id="copyLink" type="button">Copy link</button>';
    return [stamp, checks, summary, qs, ex];
  }

  /* ---------- shuffles ---------- */
  var MASC_HAIR = ['slick-back', 'pompadour', 'short', 'side-part', 'crew', 'buzz', 'flattop', 'receding', 'balding', 'bald', 'afro', 'mod-mop', 'long-straight'];
  var FEM_HAIR = ['bob', 'flip', 'mod-mop', 'pixie', 'long-straight', 'ponytail', 'bun', 'afro', 'beehive', 'bowl-bob', 'side-part', 'short'];
  var TRIADS = [['cloth-cream', 'cloth-sea', 'cloth-red'], ['cloth-white', 'cloth-navy', 'cloth-mustard'], ['cloth-mustard', 'cloth-chocolate', 'cloth-magenta'], ['cloth-camel', 'cloth-olive', 'cloth-orange'], ['cloth-stone', 'cloth-petrol', 'cloth-salmon'], ['cloth-black', 'cloth-oxblood', 'cloth-ochre'], ['cloth-sky', 'cloth-denim', 'cloth-white'], ['cloth-sage', 'cloth-forest', 'cloth-rust'], ['cloth-pink', 'cloth-plum', 'cloth-cream'], ['cloth-cobalt', 'cloth-ink-blue', 'cloth-cream'], ['cloth-tobacco', 'cloth-brown', 'cloth-red'], ['cloth-lilac', 'cloth-aubergine', 'cloth-mustard']];
  var SHUFFLE = {
    1: function () { var fem = S.spec.figure === 'fem'; S.spec.shape = pick(fem ? ['slim', 'hourglass', 'invtri', 'column', 'lean', 'lanky', 'oval'] : ['lean', 'rect', 'invtri', 'column', 'pear', 'oval', 'lanky']); S.spec.heightIn = 58 + Math.floor(Math.random() * 22); S.spec.build = Math.round((0.88 + Math.random() * 0.4) * 100) / 100; S.spec.age = 18 + Math.floor(Math.random() * 50); S.spec.skin = pick(SKINS); delete S.spec.heads; S.spec.body = {}; if (S.spec.age >= 48) { S.spec.hair = S.spec.hair || {}; S.spec.hair.grey = 'ink-300'; } },
    2: function () { var fem = S.spec.figure === 'fem'; var f = S.spec.face = S.spec.face || {}; S.spec.head = { shape: pick(O.head) }; f.eyes = pick(O.eyes); f.brows = pick(fem ? ['straight', 'arched', 'angled'] : O.brows); f.nose = pick(O.nose); f.mouth = pick(fem ? ['full', 'pout', 'neutral', 'thin', 'wide'] : O.mouth); f.expression = pick(O.expression); delete f.facialHair; delete f.makeup; delete f.eyewear; delete f.marks; if (!fem && chance(0.45)) f.facialHair = { type: pick(O.facialHair) }; if (fem && chance(0.6)) f.makeup = { type: pick(O.makeup), lips: pick(['cloth-red', 'cloth-brick', 'cloth-pink', 'cloth-magenta']) }; if (chance(0.3)) f.eyewear = { type: pick(O.eyewear.filter(function (e) { return e !== 'eyepatch'; })) }; if (chance(0.25)) f.marks = [pick([{ type: 'scar', at: pick(['across', 'cheek-L', 'cheek-R', 'brow-R']) }, { type: 'freckles' }, { type: 'mole', at: 'cheek-L' }, { type: 'spots' }, { type: 'plaster', at: 'nose' }])]; },
    3: function () { var fem = S.spec.figure === 'fem'; var h = S.spec.hair = S.spec.hair || {}; h.style = pick(fem ? FEM_HAIR : MASC_HAIR); h.color = pick(['cloth-black', 'cloth-chocolate', 'cloth-brown', 'cloth-tobacco', 'cloth-ochre', 'cloth-rust', 'cloth-cream', 'cloth-graphite']); delete h.hat; if (chance(0.3)) h.hat = { type: pick(fem ? ['pillbox', 'headscarf', 'beret', 'flat-cap'] : ['trilby', 'flat-cap', 'beanie', 'bowler', 'beret', 'peaked-cap']), color: pick(['cloth-charcoal', 'cloth-black', 'cloth-camel', 'cloth-oxblood']) }; },
    4: function () { var tri = pick(TRIADS); var o = S.spec.outfit || {}; ['base', 'mid', 'outer', 'neck', 'bottom', 'dress'].forEach(function (k) { if (o[k] && o[k].type) { o[k].color = k === 'neck' ? tri[2] : k === 'base' ? tri[0] : tri[1]; if (k === 'neck') o[k].spot = true; } }); if (o.bottom) { delete o.bottom.pattern; if (chance(0.25)) o.bottom.pattern = { type: pick(['check', 'hound', 'pinstripe', 'tartan', 'herringbone']) }; } },
    6: function () { var armsR = pick(['down', 'pocket', 'hip', 'lapel', 'behind']), armsL = pick(['down', 'pocket', 'hip', 'behind', 'cross']); if (armsL === 'cross') armsR = 'cross'; if (armsR === 'behind') armsL = 'behind'; var need = (S.spec.props || []).map(function (p) { return PROP_POSE[p.type]; }).filter(Boolean)[0]; if (need) armsR = need; S.spec.pose = { stance: pick(['square', 'easy', 'easy', 'wide']), weight: pick(['R', 'L']), arms: { R: armsR, L: armsL }, head: { tilt: Math.round((Math.random() - 0.5) * 8), yaw: Math.round((Math.random() - 0.5) * 20) } }; if (chance(0.12)) S.spec.pose.stoop = Math.round(Math.random() * 60) / 100; },
    14: function () { set('sheet.name', hull() ? pick(CT.NAMES.hull) : pick(CT.NAMES.first) + ' ' + pick(CT.NAMES.family)); set('sheet.alias', pick(CT.NAMES.alias)); syncNameToSpec(); }
  };
  A.shuffleStep = function (i) { var f = SHUFFLE[i]; if (!f) return false; f(); if (i < 7) S.dirty = true; A.changed(); return true; };
  A.syncNameToSpec = syncNameToSpec;

  A.SECTIONS = [
    { name: 'Playbook', build: playbookStep }, { name: 'Build', build: buildStep }, { name: 'Face', build: faceStep }, { name: 'Hair', build: hairStep }, { name: 'Wardrobe', build: wardrobeStep }, { name: 'Props', build: propsStep }, { name: 'Pose', build: poseStep },
    { name: 'Origins', build: originsStep }, { name: 'Actions', build: actionsStep }, { name: 'Abilities', build: abilitiesStep }, { name: 'Keys', build: keysStep }, { name: 'Contacts', build: contactsStep }, { name: 'Vice', build: viceStep }, { name: 'Items', build: itemsStep }, { name: 'Identity', build: identityStep }, { name: 'File', build: fileStep }
  ];
})();
