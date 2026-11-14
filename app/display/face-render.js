/* display/face-render.js — what a held spotlight's portrait can wear (suite 3.2, 3.3, 3.4; switches face.expressions, face.formats, face.badge).

   Window.B68FaceRender, and module.exports under Node. The iPad's half: the display page calls apply() once for each NPC card it draws (the `npc` overlay the stage bar holds), and with
   all three switches off apply() returns false and touches nothing. It reads only what the server already served on that overlay: the name, alias, role, faction, the figure's spec, the NPC id and the
   `look` (a few names, see face-look.js). It reads no other row and no notes, so the display GET costs no more.

   3.2 EXPRESSIONS (face.expressions): look.expr redraws the portrait with the face's expression swapped (the kit swaps eyes, brows and mouth; nothing is rotated). `afraid` is registered here
       through the kit's public registry, built from the kit's own surprised parts, so the vendored kit stays as it came. look.pose plays the signature pose once: a full figure in that pose for
       about three seconds over the card, then the portrait again. A re-laid hold (look.re) keeps the expression and does not replay the pose.
   3.3 FORMATS (face.formats): look.fmt puts the same drawn face in a licence, badge, mugshot, society page or passport (display/face-formats.js), in a duotone of the faction's colour.
   3.4 BADGE (face.badge): a stable number and glyph, the faction's style and a three to six second motif (display/face-badge.js, face-motif.js).
   The last two are separate files the page loads beside this one; a page without them simply draws without them.

   Everything is built with createElement and textContent. The portrait nodes come from env, already through the page's SVG cleaner.

   env: { document, K (the figure kit), portrait(spec, uid) -> node|null, figure(spec, uid) -> node|null, reduced, features? ({ id: bool }, the look book's way to say so), later(fn, ms) -> handle,
          ducked() -> bool, motif? (defaults to B68FaceMotif) }
   API   on(id, env) -> bool     active(env) -> bool     ensureAfraid(K) -> bool     apply(e, card, o, env) -> bool     unlock() -> bool     POSE_MS */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68FaceRender = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function tryRequire(p) { try { return require(p); } catch (e) { return null; } }
  var FL = root.B68FaceLook || (typeof require === 'function' ? tryRequire('./face-look.js') : null);
  function part(name, file) { return root[name] || (typeof require === 'function' ? tryRequire(file) : null); }
  var POSE_MS = 3200, DRAWS = 0;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function on(id, env) {
    if (env && isObj(env.features) && env.features[id] === true) return true;
    return !!(root.B68Flags && typeof root.B68Flags.on === 'function' && root.B68Flags.on(id));
  }
  function active(env) { return on('face.expressions', env) || on('face.formats', env) || on('face.badge', env); }

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }
  function kids(e) { return e && e.children ? Array.prototype.slice.call(e.children) : []; }
  /* the first element below e (at any depth: the new stage nests the head inside its speaking row, IP1) that carries the class */
  function byClass(e, cls) {
    var k = kids(e);
    for (var i = 0; i < k.length; i++) if (String(k[i].className || '').split(/\s+/).indexOf(cls) >= 0) return k[i];
    for (var j = 0; j < k.length; j++) { var d = byClass(k[j], cls); if (d) return d; }
    return null;
  }
  function empty(e) { while (e.firstChild) e.removeChild(e.firstChild); }
  function safe(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, ''); }

  /* 3.2: the kit's `afraid` expression, registered once from the kit's own surprised parts (raised inner brows, wide eyes, a small open mouth turned down) */
  var AFRAID = { brow: { angle: 1.1, knit: 0.3, raise: 0.04 }, lid: { upper: -0.6, lower: -0.1 }, mouth: { curve: -0.55, width: 0.85, open: 0.55 }, gaze: [0, 0.04] };
  function ensureAfraid(K) {
    try {
      var R = K && K.registry; if (!R || typeof R.get !== 'function' || typeof R.register !== 'function') return false;
      if (R.get('expression', 'afraid')) return true;
      var base = R.get('expression', 'surprised'); if (!base || typeof base.draw !== 'function') return false;
      R.register({ kind: 'expression', name: 'afraid', describe: 'Afraid: inner brows raised, eyes wide, a small open mouth turned down.', example: { face: { expression: 'afraid' } },
        draw: function (ctx) { var b = base.draw(ctx); return { expr: AFRAID, pieces: b && b.pieces ? b.pieces : [] }; } });
      return true;
    } catch (e) { return false; }
  }

  /* 3.2: the signature pose, once. A full figure in the named arm pose lies over the card for a few seconds and goes. */
  function playPose(doc, e, o, look, env, spec) {
    if (!look.pose || look.re || typeof env.figure !== 'function') return false;
    var fig = null;
    try { fig = env.figure(FL.poseSpec(spec, look.pose), 'dp-fl-pose-' + safe(o.id)); } catch (err) { fig = null; }
    if (!fig) return false;
    var layer = el(doc, 'div', 'dp-fl-pose'); layer.appendChild(fig); e.appendChild(layer);
    var later = typeof env.later === 'function' ? env.later : function (f, ms) { return setTimeout(f, ms); };
    later(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, POSE_MS);
    return true;
  }

  /* IP1 (overseer ruling 13/11): a look that says `tell` plays the person's tell while they are up: the face as drawn, then the tell for TELL_MS, then the face
     again, and so on every LOOP_MIN to LOOP_MAX ms, so a face that stays up for ten minutes never reads as frozen. Never while the GM's Scenes setting holds
     the screen still or the device asks for reduced motion: then the tell simply stays on the face (as a plain expression always did). The loop ends by
     itself once the holder has left the page. */
  var TELL_MS = 3600, LOOP_MIN = 12000, LOOP_MAX = 20000;
  function still(env) { return on('fx.off', env) || !!(env && env.reduced); }
  function mark(n, what) { if (n && n.setAttribute) n.setAttribute('data-fl', what); return n; }      /* which face is up, for the checks */
  function connected(n) { return !!n && (n.isConnected === undefined ? !!n.parentNode : n.isConnected); }
  function tellLoop(holder, steady, tell, env, firstMs) {
    var later = typeof env.later === 'function' ? env.later : function (f, ms) { return setTimeout(f, ms); };
    var seen = false, misses = 0;
    function put(n) { n.classList && n.classList.add('dp-fl-tell'); empty(holder); holder.appendChild(n); }
    function alive() { if (connected(holder)) { seen = true; return true; } return !seen && ++misses < 5; }
    function play() {
      if (!alive()) return;
      if (connected(holder) && !still(env)) { put(tell); later(function () { if (connected(holder) && holder.firstChild === tell) put(steady); }, TELL_MS); }
      later(play, LOOP_MIN + Math.floor(Math.random() * (LOOP_MAX - LOOP_MIN)));
    }
    later(play, firstMs + 700);
    return true;
  }
  /* the face with the expression (steady), or the tell loop; draw(spec, uidSuffix) -> node | null */
  function face(holder, spec, expr, loop, draw, env, firstMs) {
    if (!holder || !spec || !expr || typeof draw !== 'function') return false;
    var drawn = null;
    try { drawn = draw(FL.specWith(spec, { expr: expr }), '-t'); } catch (err) { drawn = null; }
    if (!drawn) return false;
    mark(drawn, loop ? 'tell' : 'expr');
    var steady = holder.firstChild;
    if (loop && steady && !still(env)) { holder.__flTell = drawn; return tellLoop(holder, steady, drawn, env, firstMs); }
    empty(holder); holder.appendChild(drawn);
    return true;
  }

  /* the format's duotone group (face-formats.js wrap) put round a face that was not in the holder when the card was wrapped */
  function tintLike(doc, holder, n) {
    var g0 = holder.querySelector ? holder.querySelector('g.dp-fl-duo') : null, flt = g0 && g0.getAttribute('filter');
    if (!flt || !n || !n.firstChild || (n.querySelector && n.querySelector('g.dp-fl-duo'))) return false;
    var g = doc.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('filter', flt); g.setAttribute('class', 'dp-fl-duo');
    while (n.firstChild) g.appendChild(n.firstChild);
    n.appendChild(g);
    return true;
  }

  function apply(e, card, o, env) {
    env = env || {};
    if (!e || !card || card.kind !== 'npc' || !FL || !env.document) return false;
    var doc = env.document, look = FL.clean(o && o.look), npc = o && isObj(o.npc) ? o.npc : {};
    var FM = part('B68FaceFormats', './face-formats.js'), BD = part('B68FaceBadge', './face-badge.js');
    var xp = on('face.expressions', env), fm = !!FM && on('face.formats', env), bd = !!BD && on('face.badge', env);
    var expr = xp && look && look.expr ? look.expr : '', fmt = fm && look && look.fmt ? look.fmt : '', pose = xp && look && look.pose ? look.pose : '';
    if (!expr && !fmt && !pose && !bd) return false;
    var faction = typeof npc.faction === 'string' ? npc.faction : '', id = o && typeof o.npcId === 'string' ? o.npcId : '';
    var uid = 'dp-fl-' + safe(o && o.id) + '-' + (++DRAWS), spec = card.spec, holder = byClass(e, 'dp-ov-portrait'), done = false;      /* IP1: ids of its own each draw (the duotone filter too) */

    if (expr || pose) ensureAfraid(env.K);
    if (expr && holder && spec && typeof env.portrait === 'function') {
      var loop = look.tell === true;
      if (face(holder, spec, expr, loop, function (sp, k) { return env.portrait(sp, uid + (loop ? k : '')); }, env, pose && !look.re ? POSE_MS : 0)) done = true;
    }
    var bi = bd ? BD.info(faction, id) : null;
    if (bi) BD.decorate(e, bi);
    if (fmt && holder) {
      FM.wrap(doc, e, holder, fmt, { name: card.name, role: typeof npc.role === 'string' ? npc.role : '', faction: faction, id: id, num: bi ? bi.num : '', slot: FL.slotOf(faction), uid: uid,
        glyph: bi && bi.slot ? BD.glyph(doc, faction, bi.slot) : null });
      done = true;
    } else if (bi) { e.appendChild(BD.strip(doc, bi, faction)); done = true; }
    if (fmt && holder && holder.__flTell) tintLike(doc, holder, holder.__flTell);      /* IP1b: the tell face wears the format's tint too (the wrap tints only the face up at the time) */
    if (pose && spec && playPose(doc, e, o, look, env, expr ? FL.specWith(spec, { expr: expr }) : spec)) done = true;
    if (bi) BD.motif(env, id, bi.slot, look);       /* once, when the spotlight first appears (not when it is laid again) */
    return done;
  }

  /* IP1 (overseer ruling 13/11): Show on iPad (the display kind `npc`, old stage or new) plays the look too. The full figure takes the signature pose for
     POSE_MS, then stands as drawn, and the tell plays on it (looped as above). e is the stage; vm.look the names the GM sent; env as for apply().
     opts.poseAt (ms, default 0): when the pose starts, for a caller that covers the figure first (the introduction card); the tell loop follows it. */
  function applyStage(e, vm, env, opts) {
    env = env || {};
    var poseAt = opts && opts.poseAt > 0 ? +opts.poseAt : 0;
    if (!e || !vm || !FL || !env.document || typeof env.figure !== 'function' || !on('face.expressions', env)) return false;
    var look = FL.clean(vm.look), spec = vm.spec, holder = byClass(e, 'dp-npc-fig');
    if (!look || !spec || !holder || !holder.firstChild || (!look.expr && !look.pose)) return false;
    ensureAfraid(env.K);
    var uid = 'dp-fls-' + safe(vm.npcId) + '-' + safe(vm.seq), done = false, steady = holder.firstChild;
    var draw = function (sp, k) { return env.figure(sp, uid + k); };
    var loop = !!look.expr && look.tell === true && !still(env), later = typeof env.later === 'function' ? env.later : function (f, ms) { return setTimeout(f, ms); };
    if (look.expr && !loop) {                     /* a plain expression (or a tell while the screen is held still): the face simply wears it */
      var ex = null;
      try { ex = draw(FL.specWith(spec, { expr: look.expr }), '-e'); } catch (err) { ex = null; }
      if (ex) { steady = mark(ex, 'expr'); empty(holder); holder.appendChild(ex); done = true; }
    }
    if (look.pose) {
      var posed = null;
      try { posed = draw(FL.poseSpec(look.expr ? FL.specWith(spec, { expr: look.expr }) : spec, look.pose), '-p'); } catch (err) { posed = null; }
      if (posed) {
        mark(posed, 'pose'); if (posed.classList) posed.classList.add('dp-fl-tell');
        var pose = function () { if (!connected(holder) && poseAt) return; empty(holder); holder.appendChild(posed);
          later(function () { if (holder.firstChild === posed) { if (steady.classList) steady.classList.add('dp-fl-tell'); empty(holder); holder.appendChild(steady); } }, POSE_MS); };
        if (poseAt) later(pose, poseAt); else pose();
        done = true;
      }
    }
    if (loop) {
      var t = null;
      try { t = draw(FL.specWith(spec, { expr: look.expr }), '-t'); } catch (err) { t = null; }
      if (t) done = tellLoop(holder, steady, mark(t, 'tell'), env, poseAt + (look.pose ? POSE_MS : 0)) || done;
    }
    return done;
  }

  function unlock() { var BD = part('B68FaceBadge', './face-badge.js'); return !!(BD && BD.unlock()); }

  return { on: on, active: active, ensureAfraid: ensureAfraid, apply: apply, applyStage: applyStage, unlock: unlock, POSE_MS: POSE_MS, TELL_MS: TELL_MS };
});
